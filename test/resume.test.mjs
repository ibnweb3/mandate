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
  name: 'Resume test',
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

// Fake wallets. The payer can be told to "crash" on its Nth call: it either moves the money and then never answers
// (the engine died after sending, before recording), or never sends at all.
function setup({ crashOn = 3, moneyMovesBeforeCrash = true, duplicateError = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mandate-r-'));
  const store = new Store(join(dir, 's.json'));
  const log = new SignedLog({ store, keyFile: join(dir, 'k'), publish: false });
  const secrets = new Map();
  const mint = (sats) => {
    const pre = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(Buffer.from(pre, 'hex')).digest('hex');
    secrets.set(hash, pre);
    return { hash, invoice: `inv:${hash}:${sats}` };
  };
  const world = { calls: 0, sent: new Set(), spent: 0, crashed: false };
  const listener = { makeInvoice: async ({ amount }) => { const m = mint(amount / 1000); return { invoice: m.invoice, payment_hash: m.hash }; } };
  const makePayer = (crash) => ({
    payInvoice: async ({ invoice }) => {
      const [, hash, sats] = invoice.split(':');
      world.calls += 1;
      if (world.sent.has(hash)) throw Object.assign(new Error('payment already sent'), { code: 'ERROR' });
      if (crash && world.calls === crashOn) {
        world.crashed = true;
        if (moneyMovesBeforeCrash) { world.sent.add(hash); world.spent += Number(sats); }
        return new Promise(() => {}); // the process "dies" here
      }
      if (duplicateError && world.calls === crashOn) throw Object.assign(new Error('payment already sent'), { code: 'ERROR' });
      world.sent.add(hash);
      world.spent += Number(sats);
      return { preimage: secrets.get(hash), fees_paid: 0 };
    },
  });
  const resolver = async (_p, sats) => mint(sats).invoice;
  const decode = (inv) => { const [, h, s] = inv.split(':'); return { paymentHash: h, satoshi: Number(s) }; };
  const check = async (_payee, hash) => (world.sent.has(hash) ? secrets.get(hash) : null);
  const make = (crash, withCheck = true) => new Engine({ store, log, listener, payer: makePayer(crash), resolver, decode, check: withCheck ? check : null });
  return { store, log, world, make };
}

async function crashedSale(s) {
  const a = s.make(true);
  await a.adoptRule(RULE(), { source_text: 't', parsed_by: 'test' });
  await a.recordDeliveries('W1', { amadou: 60, fatou: 40 });
  const sale = await a.createSale(1000);
  a.handlePayment({ notification: { payment_hash: sale.payment_hash, amount: 1_000_000, type: 'incoming' } }); // never resolves
  for (let i = 0; i < 200 && !s.world.crashed; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(s.world.crashed, 'the simulated crash happened');
  return sale.payment_hash;
}

test('a crash after sending but before recording resumes without paying that farmer twice', async () => {
  const s = setup({ crashOn: 2, moneyMovesBeforeCrash: true });
  const hash = await crashedSale(s);
  const sale = s.store.data.sales[hash];
  assert.equal(sale.status, 'paying');
  assert.equal(sale.payouts[1].status, 'pending');

  await s.make(false).resumeUnfinished(); // a fresh engine after restart
  assert.equal(sale.status, 'settled');
  assert.ok(sale.payouts.every((p) => p.status === 'paid' && p.preimage));
  assert.equal(sale.payouts[1].recovered, true);
  assert.equal(s.world.spent, 1000, 'exactly the sale amount left the wallet, nobody twice');
});

test('a crash before the money moved resumes and pays that farmer once', async () => {
  const s = setup({ crashOn: 2, moneyMovesBeforeCrash: false });
  const hash = await crashedSale(s);
  await s.make(false).resumeUnfinished();
  const sale = s.store.data.sales[hash];
  assert.equal(sale.status, 'settled');
  assert.equal(s.world.spent, 1000);
});

test('when the wallet says "already paid" but gives no receipt, nobody is paid again and it is flagged', async () => {
  const s = setup({ crashOn: 2, moneyMovesBeforeCrash: true });
  const hash = await crashedSale(s);
  await s.make(false, false).resumeUnfinished(); // no way to ask the payee wallet
  const sale = s.store.data.sales[hash];
  assert.equal(sale.payouts[1].status, 'unconfirmed');
  assert.equal(sale.status, 'partial');
  assert.equal(s.world.spent, 1000, 'the farmer was paid once, the remaining payouts completed');
  assert.ok(s.log.entries.some((r) => r.entry.type === 'payout_unconfirmed'));
  assert.ok(!s.log.entries.some((r) => r.entry.type === 'payout_sent' && r.entry.data.payee === sale.payouts[1].payee && r.entry.data.recovered));
});

test('resume does nothing for sales that are already settled or partial', async () => {
  const s = setup({ crashOn: 99 });
  const e = s.make(false);
  await e.adoptRule(RULE(), { source_text: 't', parsed_by: 'test' });
  await e.recordDeliveries('W1', { amadou: 60, fatou: 40 });
  const sale = await e.createSale(1000);
  await e.handlePayment({ notification: { payment_hash: sale.payment_hash, amount: 1_000_000, type: 'incoming' } });
  const before = s.world.calls;
  await s.make(false).resumeUnfinished();
  assert.equal(s.world.calls, before);
});
