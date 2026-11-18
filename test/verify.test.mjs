import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyEvent } from 'nostr-tools/pure';
import { Engine } from '../src/engine.mjs';
import { Store } from '../src/store.mjs';
import { SignedLog } from '../src/log.mjs';
import { verifyLog } from '../src/verify.mjs';

async function runOneSale() {
  const dir = mkdtempSync(join(tmpdir(), 'mandate-v-'));
  const store = new Store(join(dir, 's.json'));
  const log = new SignedLog({ store, keyFile: join(dir, 'k'), publish: false });
  const secrets = new Map();
  const mint = (sats) => {
    const pre = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(Buffer.from(pre, 'hex')).digest('hex');
    secrets.set(hash, pre);
    return { hash, invoice: `inv:${hash}:${sats}` };
  };
  const engine = new Engine({
    store, log,
    listener: { makeInvoice: async ({ amount }) => { const m = mint(amount / 1000); return { invoice: m.invoice, payment_hash: m.hash }; } },
    payer: { payInvoice: async ({ invoice }) => ({ preimage: secrets.get(invoice.split(':')[1]), fees_paid: 0 }) },
    resolver: async (_p, sats) => mint(sats).invoice,
    decode: (i) => { const [, h, s] = i.split(':'); return { paymentHash: h, satoshi: Number(s) }; },
  });
  await engine.adoptRule({
    version: 1, name: 'T',
    payees: { a: { label: 'A', dest: { type: 'demo_wallet', value: 'a' } }, b: { label: 'B', dest: { type: 'demo_wallet', value: 'b' } } },
    legs: [{ kind: 'percent', payee: 'a', percent: 20 }, { kind: 'by_weight', payees: ['b'], percent: 'rest' }],
  }, { source_text: 't', parsed_by: 'test' });
  await engine.recordDeliveries('W1', { b: 5 });
  const sale = await engine.createSale(1000);
  await engine.handlePayment({ notification: { payment_hash: sale.payment_hash, amount: 1_000_000, type: 'incoming' } });
  return { events: log.entries.map((r) => r.event), pubkey: log.pubkey };
}
const opts = (pubkey) => ({ pubkey, verifySignature: verifyEvent });

test('an honest log verifies end to end', async () => {
  const { events, pubkey } = await runOneSale();
  const r = await verifyLog(events, opts(pubkey));
  assert.equal(r.logOk, true);
  assert.deepEqual(r.problems, []);
  assert.equal(r.sales.length, 1);
  assert.equal(r.sales[0].verified, true);
  assert.equal(r.sales[0].paid_total, 1000);
});

test('editing an amount inside an event breaks verification', async () => {
  const { events, pubkey } = await runOneSale();
  const forged = JSON.parse(JSON.stringify(events));
  const i = forged.findIndex((e) => JSON.parse(e.content).type === 'payout_sent');
  const body = JSON.parse(forged[i].content);
  body.data.sats += 100;
  forged[i].content = JSON.stringify(body); // signature no longer matches
  const r = await verifyLog(forged, opts(pubkey));
  assert.ok(r.problems.length > 0);
  assert.equal(r.sales[0]?.verified ?? false, false);
});

test('a missing entry is detected', async () => {
  const { events, pubkey } = await runOneSale();
  const cut = events.filter((_, i) => i !== 2);
  const r = await verifyLog(cut, opts(pubkey));
  assert.equal(r.logOk, false);
});

test('events from another key are ignored', async () => {
  const { events } = await runOneSale();
  const r = await verifyLog(events, opts('f'.repeat(64)));
  assert.equal(r.entries.length, 0);
});
