import test from 'node:test';
import assert from 'node:assert/strict';
import { propose, parseWithGrammar } from '../src/parser.mjs';
import { computeSplit } from '../src/rule.mjs';

test('co-op sentence becomes a valid rule', async () => {
  const p = await propose('10% of each sale goes to Co-op costs. Split the rest between Amadou, Fatou and Ousmane by kg delivered.');
  assert.equal(p.valid, true, p.errors.join());
  assert.deepEqual(p.rule.legs[0], { kind: 'percent', payee: 'co_op_costs', percent: 10 });
  assert.deepEqual(p.rule.legs[1], { kind: 'by_weight', payees: ['amadou', 'fatou', 'ousmane'], percent: 'rest' });
  assert.equal(p.parsed_by, 'built-in grammar');
});

test('supplier repayment sentence with a cap', async () => {
  const p = await propose('Pay 20% of each sale to Kofi Supplies until 500000 sats are paid');
  assert.equal(p.valid, true, p.errors.join());
  assert.deepEqual(p.rule.legs[0], { kind: 'percent_until', payee: 'kofi_supplies', percent: 20, cap_sats: 500000 });
});

test('the parsed rule drives the real arithmetic', async () => {
  const p = await propose('10% to Coop. Split the rest between Amadou and Fatou by kg.');
  const s = computeSplit(p.rule, 1000, { weights: { amadou: 1, fatou: 1 } });
  assert.equal(s.payouts.reduce((a, x) => a + x.sats, 0), 1000);
});

test('what it cannot understand is reported, not guessed', async () => {
  const p = await propose('Give everyone a nice bonus whenever it feels right');
  assert.equal(p.valid, false);
  assert.match(p.notes.join(), /Could not understand/);
});

test('over-100% instructions are caught by the validator, not by the AI', async () => {
  const p = await propose('70% to Amadou. 50% to Fatou.');
  assert.equal(p.valid, false);
  assert.match(p.errors.join(), /above 100%/);
});

test('a set destination is used instead of a placeholder', () => {
  const p = parseWithGrammar('10% to Amadou', { amadou: { type: 'lightning_address', value: 'amadou@example.com' } });
  assert.equal(p.rule.payees.amadou.dest.value, 'amadou@example.com');
  assert.equal(p.notes.length, 0);
});

test('LLM parser failure falls back to the grammar and says so', async () => {
  const p = await propose('10% to Coop. Split the rest between Amadou and Fatou by kg.', { llm: { apiKey: 'x', fetchImpl: async () => ({ ok: false, status: 500 }) } });
  assert.equal(p.valid, true);
  assert.match(p.notes.join(), /used the built-in parser/);
});
