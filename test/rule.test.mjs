import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRule, computeSplit, hashOf, canonical } from '../src/rule.mjs';

const coop = () => ({
  version: 1,
  name: 'Shea co-op',
  payees: {
    coop: { label: 'Co-op costs', dest: { type: 'demo_wallet', value: 'coop' } },
    amadou: { label: 'Amadou', dest: { type: 'demo_wallet', value: 'amadou' } },
    fatou: { label: 'Fatou', dest: { type: 'demo_wallet', value: 'fatou' } },
    ousmane: { label: 'Ousmane', dest: { type: 'lightning_address', value: 'ousmane@example.com' } },
  },
  legs: [
    { kind: 'percent', payee: 'coop', percent: 10 },
    { kind: 'by_weight', payees: ['amadou', 'fatou', 'ousmane'], percent: 'rest' },
  ],
});

test('a valid rule passes', () => assert.equal(validateRule(coop()).ok, true));

test('rejects over 100%, unknown payees, bad addresses, rest not last', () => {
  const r = coop();
  r.legs[0].percent = 60;
  r.legs.push({ kind: 'percent', payee: 'coop', percent: 50 });
  assert.match(validateRule(r).errors.join(' '), /above 100%/);
  const u = coop();
  u.legs[0].payee = 'ghost';
  assert.match(validateRule(u).errors.join(' '), /unknown payee "ghost"/);
  const a = coop();
  a.payees.ousmane.dest.value = 'not-an-address';
  assert.match(validateRule(a).errors.join(' '), /not a Lightning address/);
  const l = coop();
  l.legs = [{ kind: 'by_weight', payees: ['amadou'], percent: 'rest' }, { kind: 'percent', payee: 'coop', percent: 5 }];
  assert.match(validateRule(l).errors.join(' '), /last step/);
});

test('split: 10% costs, rest by kg, exact total', () => {
  const s = computeSplit(coop(), 1000, { weights: { amadou: 50, fatou: 30, ousmane: 20 } });
  const by = Object.fromEntries(s.payouts.map((p) => [p.payee, p.sats]));
  assert.deepEqual(by, { coop: 100, amadou: 450, fatou: 270, ousmane: 180 });
  assert.equal(s.kept, 0);
});

test('split never loses or invents a sat (property check)', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i++) {
    const sale = 1 + Math.floor(rnd() * 100000);
    const w = { amadou: 1 + Math.floor(rnd() * 90), fatou: 1 + Math.floor(rnd() * 90), ousmane: 0.5 + Math.floor(rnd() * 90) };
    const s = computeSplit(coop(), sale, { weights: w });
    assert.equal(s.payouts.reduce((a, p) => a + p.sats, 0) + s.kept, sale);
    assert.ok(s.payouts.every((p) => Number.isInteger(p.sats) && p.sats > 0));
  }
});

test('same input, same output (deterministic)', () => {
  const ctx = { weights: { amadou: 7, fatou: 7, ousmane: 7 } };
  assert.deepEqual(computeSplit(coop(), 1001, ctx), computeSplit(coop(), 1001, ctx));
});

test('no deliveries recorded: the member share stays with the owner', () => {
  const s = computeSplit(coop(), 1000, { weights: {} });
  assert.deepEqual(s.payouts, [{ payee: 'coop', sats: 100 }]);
  assert.equal(s.kept, 900);
  assert.match(s.warnings.join(), /No deliveries/);
});

test('supplier repayment stops at the cap', () => {
  const r = {
    version: 1,
    name: 'Repay supplier',
    payees: { supplier: { label: 'Supplier', dest: { type: 'demo_wallet', value: 'supplier' } } },
    legs: [{ kind: 'percent_until', payee: 'supplier', percent: 20, cap_sats: 500 }],
  };
  assert.deepEqual(computeSplit(r, 1000, {}).payouts, [{ payee: 'supplier', sats: 200 }]);
  assert.deepEqual(computeSplit(r, 1000, { paidToDate: { supplier: 400 } }).payouts, [{ payee: 'supplier', sats: 100 }]);
  assert.deepEqual(computeSplit(r, 1000, { paidToDate: { supplier: 500 } }).payouts, []);
});

test('hash ignores key order but notices any change', async () => {
  const a = coop();
  const b = JSON.parse(JSON.stringify(a));
  b.payees = Object.fromEntries(Object.entries(b.payees).reverse());
  assert.equal(await hashOf(a), await hashOf(b));
  b.legs[0].percent = 11;
  assert.notEqual(await hashOf(a), await hashOf(b));
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});
