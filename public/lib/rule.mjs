// Pure rule logic. No I/O, no wallet, no AI. Runs unchanged in Node and in the browser,
// so the public proof page can redo the exact arithmetic the engine did.

export const RULE_VERSION = 1;
export const MAX_PAYEES = 30;
const ID = /^[a-z][a-z0-9_]{0,23}$/;

// Canonical JSON: sorted keys, no whitespace. The same rule always hashes the same.
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const hashOf = (value) => sha256Hex(canonical(value));

const bps = (percent) => Math.round(percent * 100);

/**
 * Rule shape
 * {
 *   version: 1, name,
 *   payees: { id: { label, dest: { type: 'lightning_address' | 'demo_wallet', value } } },
 *   legs: [
 *     { kind: 'percent',       payee, percent }                    // share of the gross sale
 *     { kind: 'percent_until', payee, percent, cap_sats }          // same, until the lifetime total hits the cap
 *     { kind: 'by_weight',     payees: [ids], percent | 'rest' }   // share of the gross, split by weights
 *   ]
 * }
 * Whatever is not allocated stays in the owner's wallet.
 */
export function validateRule(rule) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!rule || typeof rule !== 'object') return { ok: false, errors: ['The rule is empty.'] };
  if (rule.version !== RULE_VERSION) err(`Unsupported rule version (expected ${RULE_VERSION}).`);
  if (typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 80) err('The rule needs a name (1 to 80 characters).');

  const payees = rule.payees && typeof rule.payees === 'object' ? rule.payees : null;
  if (!payees) err('The rule has no payees.');
  else {
    const ids = Object.keys(payees);
    if (!ids.length) err('The rule has no payees.');
    if (ids.length > MAX_PAYEES) err(`At most ${MAX_PAYEES} payees.`);
    for (const id of ids) {
      const p = payees[id];
      if (!ID.test(id)) err(`Payee id "${id}" must be lowercase letters, digits or underscore.`);
      if (!p || typeof p.label !== 'string' || !p.label.trim() || p.label.length > 60) err(`Payee "${id}" needs a label.`);
      const d = p?.dest;
      if (!d || !['lightning_address', 'demo_wallet'].includes(d.type) || typeof d.value !== 'string' || !d.value.trim()) {
        err(`Payee "${id}" needs a destination (lightning_address or demo_wallet).`);
      } else if (d.type === 'lightning_address' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.value)) {
        err(`Payee "${id}": "${d.value}" is not a Lightning address.`);
      } else if (d.type === 'demo_wallet' && !ID.test(d.value)) {
        err(`Payee "${id}": demo wallet handle "${d.value}" is invalid.`);
      }
    }
  }

  const legs = Array.isArray(rule.legs) ? rule.legs : null;
  if (!legs || !legs.length) err('The rule needs at least one payout step.');
  else {
    let total = 0;
    legs.forEach((leg, i) => {
      const at = `Step ${i + 1}`;
      const known = (id) => payees && Object.hasOwn(payees, id);
      if (!leg || !['percent', 'percent_until', 'by_weight'].includes(leg.kind)) return err(`${at}: unknown kind.`);
      if (leg.kind === 'by_weight') {
        if (!Array.isArray(leg.payees) || !leg.payees.length) err(`${at}: needs a list of payees.`);
        else {
          if (new Set(leg.payees).size !== leg.payees.length) err(`${at}: a payee is listed twice.`);
          for (const id of leg.payees) if (!known(id)) err(`${at}: unknown payee "${id}".`);
        }
      } else if (!known(leg.payee)) err(`${at}: unknown payee "${leg.payee}".`);

      if (leg.percent === 'rest') {
        if (leg.kind !== 'by_weight') err(`${at}: "rest" only works on a weighted step.`);
        if (i !== legs.length - 1) err(`${at}: "rest" must be the last step.`);
      } else {
        const ok = typeof leg.percent === 'number' && Number.isFinite(leg.percent) && leg.percent > 0 && leg.percent <= 100
          && Math.abs(leg.percent * 100 - Math.round(leg.percent * 100)) < 1e-9;
        if (!ok) err(`${at}: percent must be above 0, at most 100, with at most 2 decimals.`);
        else total += leg.percent;
      }
      if (leg.kind === 'percent_until' && !(Number.isInteger(leg.cap_sats) && leg.cap_sats > 0)) err(`${at}: cap_sats must be a positive whole number.`);
    });
    if (total > 100 + 1e-9) err(`The percentages add up to ${+total.toFixed(2)}%, above 100%.`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Split one sale. Deterministic: the same inputs always give the same output.
 * ctx.weights:    { payeeId: positive number }   (e.g. kg delivered)
 * ctx.paidToDate: { payeeId: sats paid before }  (for percent_until caps)
 * Returns { payouts: [{payee, sats}], kept, warnings }.
 * sum(payouts) + kept === saleSats, always.
 */
export function computeSplit(rule, saleSats, ctx = {}) {
  if (!Number.isInteger(saleSats) || saleSats < 1) throw new Error('saleSats must be a positive whole number');
  const weights = ctx.weights ?? {};
  const paidToDate = ctx.paidToDate ?? {};
  const warnings = [];
  const owed = new Map(); // payee -> sats
  const add = (id, sats) => { if (sats > 0) owed.set(id, (owed.get(id) ?? 0) + sats); };
  let allocated = 0;

  for (const leg of rule.legs) {
    let pool = leg.percent === 'rest' ? saleSats - allocated : Math.floor((saleSats * bps(leg.percent)) / 10000);
    if (leg.kind === 'percent_until') {
      const room = Math.max(0, leg.cap_sats - (paidToDate[leg.payee] ?? 0) - (owed.get(leg.payee) ?? 0));
      if (pool > room) warnings.push(`${leg.payee}: capped at ${leg.cap_sats} sats in total`);
      pool = Math.min(pool, room);
    }
    if (leg.kind === 'by_weight') {
      const members = leg.payees.filter((id) => Number.isFinite(weights[id]) && weights[id] > 0);
      if (!members.length) {
        warnings.push('No deliveries recorded: that share stays with the owner');
        continue;
      }
      // Largest-remainder method on integers: nobody is shorted and the total is exact.
      // Weights are scaled to integers (3 decimals) so the arithmetic is exact.
      const scaled = members.map((id) => ({ id, w: Math.max(1, Math.round(weights[id] * 1000)) }));
      const SW = scaled.reduce((s, m) => s + m.w, 0);
      const rows = scaled.map((m) => {
        const exact = pool * m.w;
        return { id: m.id, base: Math.floor(exact / SW), rem: exact % SW };
      });
      let left = pool - rows.reduce((s, r) => s + r.base, 0);
      for (const r of [...rows].sort((a, b) => b.rem - a.rem || (a.id < b.id ? -1 : 1))) {
        if (left <= 0) break;
        r.base += 1;
        left -= 1;
      }
      for (const r of rows) add(r.id, r.base);
    } else add(leg.payee, pool);
    allocated += pool;
  }

  const payouts = [...owed.entries()].map(([payee, sats]) => ({ payee, sats })).filter((p) => p.sats > 0);
  const paid = payouts.reduce((s, p) => s + p.sats, 0);
  return { payouts, kept: saleSats - paid, warnings };
}

// Plain-English summary of a rule, shown in the confirm step so the owner reads what the code will do.
export function describeRule(rule) {
  const label = (id) => rule.payees[id]?.label ?? id;
  return rule.legs.map((leg) => {
    const pct = leg.percent === 'rest' ? 'Everything left' : `${leg.percent}% of each sale`;
    if (leg.kind === 'by_weight') return `${pct} is shared by weight between ${leg.payees.map(label).join(', ')}.`;
    if (leg.kind === 'percent_until') return `${pct} goes to ${label(leg.payee)}, until ${leg.cap_sats.toLocaleString('en')} sats have been paid in total.`;
    return `${pct} goes to ${label(leg.payee)}.`;
  });
}
