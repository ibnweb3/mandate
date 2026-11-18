import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/engine.mjs';
import { Store } from '../src/store.mjs';
import { SignedLog } from '../src/log.mjs';

const RULE = () => ({
  version: 1,
  name: 'Test co-op',
  payees: {
    coop: { label: 'Co-op', dest: { type: 'demo_wallet', value: 'coop' } },
    amadou: { label: 'Amadou', dest: { type: 'demo_wallet', value: 'amadou' } },
    fatou: { label: 'Fatou', dest: { type: 'demo_wallet', value: 'fatou' } },
  },
  legs: [
    { kind: 'percent', payee: 'coop', percent: 10 },
    { kind: 'by_weight', payees: ['amadou', 'fatou'], percent: 'rest' },
  ],
});

// Fake wallets. An "invoice" is just "inv:<hash>:<sats>"; the preimage hashes to <hash>.
function harness({ budget = Infinity, lieAboutAmount = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mandate-'));
  const store = new Store(join(dir, 'state.json'));
  const log = new SignedLog({ store, keyFile: join(dir, 'k'), publish: false });
  const secrets = new Map();
  const mint = (sats) => {
    const pre = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(Buffer.from(pre, 'hex')).digest('hex');
    secrets.set(hash, pre);
    return { hash, invoice: `inv:${hash}:${lieAboutAmount ? sats + 5 : sats}` };
  };
  const state = { spent: 0, paid: [], budget };
  const listener = { makeInvoice: async ({ amount }) => { const m = mint(amount / 1000); return { invoice: m.invoice, payment_hash: m.hash }; }, lookupInvoice: async () => ({}) };
  const payer = {
    payInvoice: async ({ invoice }) => {
      const [, hash, sats] = invoice.split(':');
      if (state.spent + Number(sats) > state.budget) throw Object.assign(new Error('Your app does not have enough budget remaining'), { code: 'QUOTA_EXCEEDED' });
      state.spent += Number(sats);
      state.paid.push({ hash, sats: Number(sats) });
      return { preimage: secrets.get(hash), fees_paid: 0 };
    },
  };
  const resolver = async (_payee, sats) => mint(sats).invoice;
  const decode = (inv) => { const [, hash, sats] = inv.split(':'); return { paymentHash: hash, satoshi: Number(sats) }; };
  const engine = new Engine({ store, log, listener, payer, resolver, decode });
  return { engine, store, log, state };
}

async function ready(h) {
  await h.engine.adoptRule(RULE(), { source_text: '10% to the co-op, rest by kg', parsed_by: 'test' });
  await h.engine.recordDeliveries('Week 1', { amadou: 60, fatou: 40 });
}

test('a sale is split exactly by the rule and every payout has proof', async () => {
  const h = harness();
  await ready(h);
  const sale = await h.engine.createSale(1000, 'shea butter');
  await h.engine.handlePayment({ notification_type: 'payment_received', notification: { payment_hash: sale.payment_hash, amount: 1_000_000, type: 'incoming' } });
  const rec = h.store.data.sales[sale.payment_hash];
  assert.equal(rec.status, 'settled');
  const by = Object.fromEntries(rec.payouts.map((p) => [p.payee, p.sats]));
  assert.deepEqual(by, { coop: 100, amadou: 540, fatou: 360 });
  assert.ok(rec.payouts.every((p) => p.status === 'paid' && p.preimage));
  assert.equal(h.state.spent, 1000);
});

test('a replayed notification never pays twice', async () => {
  const h = harness();
  await ready(h);
  const sale = await h.engine.createSale(1000);
  const note = { notification_type: 'payment_received', notification: { payment_hash: sale.payment_hash, amount: 1_000_000, type: 'incoming' } };
  await h.engine.handlePayment(note);
  await h.engine.handlePayment(note);
  await h.engine.handlePayment(note);
  assert.equal(h.state.paid.length, 3); // coop + amadou + fatou, once each
});

test('payments that were not minted as sales are ignored, not split', async () => {
  const h = harness();
  await ready(h);
  await h.engine.handlePayment({ notification_type: 'payment_received', notification: { payment_hash: 'ab'.repeat(32), amount: 50_000_000, type: 'incoming' } });
  assert.equal(h.state.paid.length, 0);
  assert.equal(h.store.data.ignored['ab'.repeat(32)], 'not a Mandate sale invoice');
});

test('the plan is logged before the first payout', async () => {
  const h = harness();
  await ready(h);
  const sale = await h.engine.createSale(1000);
  await h.engine.handlePayment({ notification: { payment_hash: sale.payment_hash, amount: 1_000_000, type: 'incoming' } });
  const types = h.log.entries.map((r) => r.entry.type);
  assert.ok(types.indexOf('sale_received') < types.indexOf('payout_sent'));
  assert.equal(types.at(-1), 'sale_settled');
});

test('wallet budget refusal is logged, and a retry after the budget is raised completes the sale', async () => {
  const h = harness({ budget: 500 });
  await ready(h);
  const sale = await h.engine.createSale(1000);
  await h.engine.handlePayment({ notification: { payment_hash: sale.payment_hash, amount: 1_000_000, type: 'incoming' } });
  const rec = h.store.data.sales[sale.payment_hash];
  assert.equal(rec.status, 'partial');
  assert.ok(h.log.entries.some((r) => r.entry.type === 'payout_refused'));
  assert.ok(h.state.spent <= 500);
  h.state.budget = 5000;
  await h.engine.retry(sale.payment_hash);
  assert.equal(rec.status, 'settled');
  assert.equal(h.state.spent, 1000);
});

test('an invoice that asks for the wrong amount is rejected, not paid', async () => {
  const h = harness({ lieAboutAmount: true });
  await ready(h);
  const sale = await h.engine.createSale(1000);
  await h.engine.handlePayment({ notification: { payment_hash: sale.payment_hash, amount: 1_000_000, type: 'incoming' } });
  assert.equal(h.state.paid.length, 0);
  assert.match(h.store.data.sales[sale.payment_hash].payouts[0].error, /INVOICE_MISMATCH/);
});

test('bad rules and bad deliveries are refused', async () => {
  const h = harness();
  const bad = RULE();
  bad.legs[0].percent = 150;
  await assert.rejects(() => h.engine.adoptRule(bad, { source_text: 'x', parsed_by: 'test' }), /above 100%|percent must/);
  await h.engine.adoptRule(RULE(), { source_text: 'x', parsed_by: 'test' });
  await assert.rejects(() => h.engine.recordDeliveries('W1', { coop: 5 }), /not a weighted payee/);
  await assert.rejects(() => h.engine.recordDeliveries('W1', { amadou: -3 }), /Invalid amount/);
});

test('log entries chain together', async () => {
  const h = harness();
  await ready(h);
  const rows = h.log.entries;
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].entry.prev, rows[i - 1].entry.id);
});
