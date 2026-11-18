// The engine. It never decides amounts with AI: amounts come from computeSplit() (pure maths)
// over a rule the owner confirmed. It writes its plan to the signed log BEFORE paying, and
// the wallet enforces the spending budget no matter what this code does.
import { createHash } from 'node:crypto';
import { computeSplit, describeRule, hashOf, validateRule } from './rule.mjs';

const sha256Bytes = (hex) => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
const msatsToSats = (m) => Math.floor(Number(m) / 1000);

export class Engine {
  /**
   * listener: { makeInvoice({amount(msats), description}), lookupInvoice({payment_hash}) }
   * payer:    { payInvoice({invoice}) }              (budget-capped by the wallet)
   * resolver: async (payee, sats, memo) => bolt11     (asks the payee's wallet for an invoice)
   * decode:   (bolt11) => { paymentHash, satoshi }
   */
  constructor({ store, log, listener, payer, resolver, decode }) {
    Object.assign(this, { store, log, listener, payer, resolver, decode });
    this.queue = Promise.resolve();
  }

  get data() { return this.store.data; }
  get ruleHash() { return this.data.rule?.hash ?? null; }

  // ---- owner actions -------------------------------------------------------------------

  async adoptRule(rule, { source_text, parsed_by }) {
    const v = validateRule(rule);
    if (!v.ok) throw Object.assign(new Error(v.errors.join(' ')), { code: 'INVALID_RULE', errors: v.errors });
    const hash = await hashOf(rule);
    this.data.rule = { rule, hash, adopted_at: new Date().toISOString(), source_text, parsed_by };
    this.data.deliveries = null; // weights belong to the rule they were recorded under
    await this.log.append('rule_adopted', { rule, rule_hash: hash, source_text, parsed_by, plain: describeRule(rule), confirmed_by: 'owner' });
    return this.data.rule;
  }

  async recordDeliveries(period, entries) {
    const active = this.data.rule;
    if (!active) throw Object.assign(new Error('Adopt a rule first.'), { code: 'NO_RULE' });
    const weighted = new Set(active.rule.legs.filter((l) => l.kind === 'by_weight').flatMap((l) => l.payees));
    const clean = {};
    for (const [id, kg] of Object.entries(entries ?? {})) {
      if (!weighted.has(id)) throw Object.assign(new Error(`"${id}" is not a weighted payee in this rule.`), { code: 'BAD_DELIVERY' });
      const n = Number(kg);
      if (!Number.isFinite(n) || n < 0 || n > 1e6) throw Object.assign(new Error(`Invalid amount for ${id}.`), { code: 'BAD_DELIVERY' });
      if (n > 0) clean[id] = Math.round(n * 1000) / 1000;
    }
    if (typeof period !== 'string' || !period.trim() || period.length > 60) throw Object.assign(new Error('Name the period (e.g. "Week 46").'), { code: 'BAD_DELIVERY' });
    const rec = { period: period.trim(), entries: clean };
    const hash = await hashOf(rec);
    this.data.deliveries = { ...rec, hash, recorded_at: new Date().toISOString() };
    await this.log.append('deliveries_recorded', { ...rec, hash, rule_hash: this.ruleHash });
    return this.data.deliveries;
  }

  async createSale(sats, note = '') {
    if (!this.data.rule) throw Object.assign(new Error('Adopt a rule before taking sales.'), { code: 'NO_RULE' });
    if (!Number.isInteger(sats) || sats < 1 || sats > 1_000_000) throw Object.assign(new Error('Amount must be a whole number of sats between 1 and 1,000,000.'), { code: 'BAD_AMOUNT' });
    const tx = await this.listener.makeInvoice({ amount: sats * 1000, description: (note || 'Sale').slice(0, 100) });
    this.data.invoices[tx.payment_hash] = { amount_sats: sats, note: note.slice(0, 100), created_at: new Date().toISOString(), invoice: tx.invoice };
    this.store.save();
    return { invoice: tx.invoice, payment_hash: tx.payment_hash, amount_sats: sats };
  }

  // ---- incoming payments ---------------------------------------------------------------

  handlePayment(notification) {
    const n = notification?.notification ?? notification;
    if (notification?.notification_type && notification.notification_type !== 'payment_received') return this.queue;
    this.queue = this.queue.then(() => this.#process(n)).catch((e) => console.error('engine error:', e?.message ?? e));
    return this.queue;
  }

  // On startup (and on demand): find sale invoices that were paid while we were offline.
  async catchUp() {
    for (const [hash, inv] of Object.entries(this.data.invoices)) {
      if (this.data.sales[hash]) continue;
      try {
        const tx = await this.listener.lookupInvoice({ payment_hash: hash });
        if (tx?.settled_at || tx?.state === 'settled') await this.handlePayment({ payment_hash: hash, amount: inv.amount_sats * 1000, type: 'incoming' });
      } catch { /* not paid yet, or wallet briefly unreachable */ }
    }
    await this.queue;
  }

  async #process(n) {
    const hash = n?.payment_hash;
    if (!hash || (n.type && n.type !== 'incoming')) return;
    if (this.data.sales[hash]) return; // dedupe: notifications can be replayed
    const inv = this.data.invoices[hash];
    if (!inv) { this.data.ignored[hash] = 'not a Mandate sale invoice'; this.store.save(); return; }
    const active = this.data.rule;
    if (!active) { this.data.ignored[hash] = 'no rule adopted'; this.store.save(); return; }

    const amount = msatsToSats(n.amount) || inv.amount_sats;
    const weights = this.data.deliveries?.entries ?? {};
    const paidToDate = this.#paidToDate();
    const split = computeSplit(active.rule, amount, { weights, paidToDate });
    const sale = {
      payment_hash: hash, amount_sats: amount, received_at: new Date().toISOString(), note: inv.note,
      rule_hash: active.hash, weights, weights_hash: this.data.deliveries?.hash ?? null, period: this.data.deliveries?.period ?? null,
      kept: split.kept, warnings: split.warnings, status: 'paying',
      payouts: split.payouts.map((p) => ({ ...p, label: active.rule.payees[p.payee].label, status: 'planned' })),
    };
    this.data.sales[hash] = sale;
    this.store.save();
    // The plan is committed to the signed log before a single sat moves.
    await this.log.append('sale_received', {
      payment_hash: hash, amount_sats: amount, rule_hash: active.hash, weights, weights_hash: sale.weights_hash, period: sale.period,
      paid_to_date: paidToDate, plan: { payouts: split.payouts, kept: split.kept, warnings: split.warnings },
    });
    await this.#payAll(sale);
  }

  #paidToDate() {
    const out = {};
    for (const s of Object.values(this.data.sales)) for (const p of s.payouts) if (p.status === 'paid') out[p.payee] = (out[p.payee] ?? 0) + p.sats;
    return out;
  }

  async #payAll(sale) {
    for (const p of sale.payouts) if (p.status !== 'paid') await this.#payOne(sale, p);
    const unpaid = sale.payouts.filter((p) => p.status !== 'paid');
    sale.status = unpaid.length ? 'partial' : 'settled';
    this.store.save();
    await this.log.append(unpaid.length ? 'sale_partial' : 'sale_settled', {
      payment_hash: sale.payment_hash,
      paid: sale.payouts.filter((p) => p.status === 'paid').map((p) => ({ payee: p.payee, sats: p.sats })),
      unpaid: unpaid.map((p) => ({ payee: p.payee, sats: p.sats, status: p.status })),
      kept: sale.kept,
    });
  }

  async #payOne(sale, p) {
    const rule = this.data.rule.rule;
    try {
      if (!p.invoice) {
        p.invoice = await this.resolver(rule.payees[p.payee], p.sats, `Payout from ${rule.name}`);
        const d = this.decode(p.invoice);
        // Never trust a payee's invoice: the amount must be exactly what the rule computed.
        if (d.satoshi !== p.sats) throw Object.assign(new Error(`Invoice asks for ${d.satoshi} sats, the rule says ${p.sats}.`), { code: 'INVOICE_MISMATCH', final: true });
        p.invoice_hash = d.paymentHash;
      }
      p.status = 'pending';
      this.store.save();
      const res = await this.payer.payInvoice({ invoice: p.invoice });
      if (!res?.preimage || sha256Bytes(res.preimage) !== p.invoice_hash) throw Object.assign(new Error('Wallet returned no valid proof of payment.'), { code: 'BAD_PREIMAGE' });
      Object.assign(p, { status: 'paid', preimage: res.preimage, fees_msats: Number(res.fees_paid ?? 0), error: undefined });
      this.store.save();
      await this.log.append('payout_sent', {
        sale: sale.payment_hash, payee: p.payee, sats: p.sats, payment_hash: p.invoice_hash, preimage: p.preimage, fees_msats: p.fees_msats,
      });
    } catch (e) {
      const code = e?.code ?? 'ERROR';
      const refused = code === 'QUOTA_EXCEEDED' || code === 'RESTRICTED';
      p.status = refused ? 'refused' : 'failed';
      p.error = `${code}: ${e?.message ?? e}`.slice(0, 200);
      if (refused || e?.final) { delete p.invoice; delete p.invoice_hash; } // definitely unpaid: a retry may use a fresh invoice
      this.store.save();
      await this.log.append(refused ? 'payout_refused' : 'payout_failed', { sale: sale.payment_hash, payee: p.payee, sats: p.sats, error: p.error });
    }
  }

  // Retry whatever did not go out (for example after the owner raises the wallet budget).
  retry(paymentHash) {
    const sale = this.data.sales[paymentHash];
    if (!sale || sale.status === 'settled') return Promise.resolve(sale);
    this.queue = this.queue.then(() => this.#payAll(sale)).catch((e) => console.error('retry error:', e?.message ?? e));
    return this.queue.then(() => sale);
  }

  idle() { return this.queue; }
}
