// Independent verifier. Pure functions plus an injected signature check, so the exact same
// file runs in Node (tests) and in the public proof page (browser). It trusts nothing the
// engine says: it re-derives hashes, re-does the split arithmetic and re-checks every proof.
import { canonical, computeSplit, hashOf, validateRule } from './rule.mjs';

const hexBytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
async function sha256OfHex(hex) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', hexBytes(hex));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const same = (a, b) => canonical(a) === canonical(b);

/**
 * events: Nostr events (any order, may include duplicates or foreign events)
 * opts:   { pubkey, verifySignature(event) => boolean }
 * returns { logOk, problems[], entries[], rules{}, sales[] }
 */
export async function verifyLog(events, { pubkey, verifySignature }) {
  const problems = [];
  const byId = new Map();
  for (const ev of events) {
    if (ev?.pubkey !== pubkey) continue;
    if (!ev.tags?.some((t) => t[0] === 't' && t[1] === 'mandate')) continue;
    let entry;
    try { entry = JSON.parse(ev.content); } catch { problems.push(`Event ${String(ev.id).slice(0, 8)} is not valid JSON.`); continue; }
    if (!verifySignature(ev)) { problems.push(`Event ${String(ev.id).slice(0, 8)} has a bad signature and was ignored.`); continue; }
    byId.set(entry.id, { entry, ev });
  }
  const rows = [...byId.values()].sort((a, b) => a.entry.seq - b.entry.seq);

  // 1. chain: contiguous sequence, each id = hash of its body, each prev = previous id
  let prev = '0'.repeat(64);
  let logOk = true;
  const good = [];
  for (let i = 0; i < rows.length; i++) {
    const { entry } = rows[i];
    const { id, ...body } = entry;
    const expectId = await hashOf(body);
    if (entry.seq !== i) { problems.push(`Entry ${i} is missing (found #${entry.seq}).`); logOk = false; break; }
    if (id !== expectId) { problems.push(`Entry #${i} was altered (its hash does not match).`); logOk = false; break; }
    if (entry.prev !== prev) { problems.push(`Entry #${i} does not link to the one before it.`); logOk = false; break; }
    prev = id;
    good.push(entry);
  }

  // 2. what each entry claims
  const rules = {};      // rule_hash -> rule
  const deliveries = {}; // hash -> record
  const paid = {};       // payee -> sats paid so far (replayed in log order)
  const sales = new Map();

  for (const e of good) {
    const d = e.data;
    if (e.type === 'rule_adopted') {
      const okHash = (await hashOf(d.rule)) === d.rule_hash;
      const v = validateRule(d.rule);
      if (okHash && v.ok) rules[d.rule_hash] = d.rule;
      else problems.push(`Rule at entry #${e.seq} is invalid or its hash does not match.`);
    } else if (e.type === 'deliveries_recorded') {
      const { hash, rule_hash: _r, ...rec } = d;
      if ((await hashOf(rec)) === hash) deliveries[hash] = rec;
      else problems.push(`Delivery record at entry #${e.seq} does not match its hash.`);
    } else if (e.type === 'sale_received') {
      const checks = [];
      const rule = rules[d.rule_hash];
      checks.push({ ok: !!rule, text: rule ? 'Paid under a rule that was published and hashed before the sale' : 'The rule for this sale was never published' });
      let weightsOk = true;
      if (d.weights_hash) { weightsOk = !!deliveries[d.weights_hash] && same(deliveries[d.weights_hash].entries, d.weights); checks.push({ ok: weightsOk, text: 'Delivery weights match the signed delivery record' }); }
      let splitOk = false;
      if (rule && weightsOk) {
        const expect = computeSplit(rule, d.amount_sats, { weights: d.weights ?? {}, paidToDate: { ...paid } });
        splitOk = same(expect.payouts, d.plan.payouts) && expect.kept === d.plan.kept;
        checks.push({ ok: splitOk, text: 'Re-running the rule gives exactly the planned amounts' });
      }
      sales.set(d.payment_hash, { payment_hash: d.payment_hash, amount_sats: d.amount_sats, seq: e.seq, ts: e.ts, rule, rule_hash: d.rule_hash, period: d.period, plan: d.plan, checks, payouts: [], refused: [], status: 'planned' });
    } else if (e.type === 'payout_sent') {
      const s = sales.get(d.sale);
      const planned = s?.plan.payouts.find((p) => p.payee === d.payee);
      const proof = (await sha256OfHex(d.preimage)) === d.payment_hash;
      const ok = !!s && !!planned && planned.sats === d.sats && proof;
      if (s) s.payouts.push({ ...d, ok, proof });
      if (ok) paid[d.payee] = (paid[d.payee] ?? 0) + d.sats;
      else problems.push(`Payout to ${d.payee} at entry #${e.seq} failed verification.`);
    } else if (e.type === 'payout_refused' || e.type === 'payout_failed' || e.type === 'payout_unconfirmed') {
      sales.get(d.sale)?.refused.push({ ...d, type: e.type });
    } else if (e.type === 'sale_settled' || e.type === 'sale_partial') {
      const s = sales.get(d.payment_hash);
      if (s) s.status = e.type === 'sale_settled' ? 'settled' : 'partial';
    }
  }

  const out = [...sales.values()].map((s) => {
    const paidTotal = s.payouts.filter((p) => p.ok).reduce((a, p) => a + p.sats, 0);
    s.checks.push({ ok: logOk, text: 'The signed log is complete and unbroken' });
    s.checks.push({ ok: s.payouts.every((p) => p.ok), text: 'Every payout carries a valid proof of payment (the preimage hashes to the invoice)' });
    s.checks.push({ ok: paidTotal <= s.amount_sats, text: `Paid out ${paidTotal} of ${s.amount_sats} sats, never more than was received` });
    s.paid_total = paidTotal;
    s.verified = s.checks.every((c) => c.ok);
    return s;
  });
  return { logOk, problems, entries: good, rules, sales: out };
}
