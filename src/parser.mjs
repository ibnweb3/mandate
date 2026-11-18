// Plain words -> a proposed rule. This only PROPOSES. The owner reads the proposal in plain
// English and confirms it; validateRule() then gatekeeps it, and the engine never calls the
// AI again. Two parsers: an LLM (if a key is configured) and a built-in grammar that works
// offline for the common sentences. The result says which one produced it.
import { RULE_VERSION, validateRule } from './rule.mjs';

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'p$1').slice(0, 24) || 'payee';

// destinations: { payeeId: { type, value } } the owner has set up (demo wallets or real addresses).
// A payee mentioned in the sentence but missing here makes the proposal incomplete (reported, not guessed).
export function parseWithGrammar(text, destinations = {}, name = 'My payout rule') {
  const notes = [];
  const payees = {};
  const legs = [];
  const need = (label) => {
    const id = slug(label);
    if (!payees[id]) payees[id] = { label: label.trim(), dest: destinations[id] ?? { type: 'demo_wallet', value: id } };
    if (!destinations[id]) notes.push(`No destination set for "${label.trim()}"; using test wallet "${id}".`);
    return id;
  };
  const sentences = text.split(/[.;\n]+/).map((s) => s.trim()).filter(Boolean);
  let pendingRest = null;

  for (const raw of sentences) {
    const s = raw.replace(/\s+/g, ' ');
    let m;
    // "20% of each sale to Supplier until 500 sats are paid" / "pay 20% to Supplier until 500000 sats"
    if ((m = s.match(/(\d+(?:\.\d{1,2})?)\s*%[^,]*?\bto\s+(?:my\s+|the\s+)?(.+?)\s+until\s+(?:a total of\s+)?(\d[\d,_ ]*)\s*sats?/i))) {
      legs.push({ kind: 'percent_until', payee: need(m[2]), percent: Number(m[1]), cap_sats: Number(m[3].replace(/[^\d]/g, '')) });
      continue;
    }
    // "split the rest/remaining between members by kg delivered" (names listed after "between/among")
    if ((m = s.match(/\b(?:split|share|divide)\b.*\b(?:rest|remaining|remainder|everything else|what'?s left)\b.*?\b(?:between|among|to)\s+(.+?)(?:\s+by\s+.*)?$/i))) {
      pendingRest = m[1].split(/,|\band\b/i).map((x) => x.trim()).filter(Boolean);
      continue;
    }
    // "10% to Co-op" / "10% of each sale goes to Co-op" / "Co-op gets 10%"
    if ((m = s.match(/(\d+(?:\.\d{1,2})?)\s*%[^,]*?\b(?:to|for)\s+(?:my\s+|the\s+)?(.+)$/i))) {
      legs.push({ kind: 'percent', payee: need(m[2]), percent: Number(m[1]) });
      continue;
    }
    if ((m = s.match(/^(?:the\s+)?(.+?)\s+(?:gets|receives|takes)\s+(\d+(?:\.\d{1,2})?)\s*%/i))) {
      legs.push({ kind: 'percent', payee: need(m[1]), percent: Number(m[2]) });
      continue;
    }
    notes.push(`Could not understand: "${raw}".`);
  }
  if (pendingRest) legs.push({ kind: 'by_weight', payees: pendingRest.map(need), percent: 'rest' });
  const rule = { version: RULE_VERSION, name, payees, legs };
  return { rule, notes, parsed_by: 'built-in grammar' };
}

const SYSTEM = `You convert a plain-language payout instruction into JSON for a payment-splitting engine.
Output ONLY JSON: {"name": string, "payees": {"<id>": {"label": string}}, "legs": [...]}.
payee ids: lowercase letters, digits, underscore. Leg kinds:
 {"kind":"percent","payee":id,"percent":number}                       share of each sale
 {"kind":"percent_until","payee":id,"percent":number,"cap_sats":int}  same, until a total in sats is reached
 {"kind":"by_weight","payees":[ids],"percent":number|"rest"}          share split by delivery weights ("rest" only as the last leg)
Never invent payees, amounts or destinations. If something is unclear, omit it and add it to "unclear": [strings].`;

export async function parseWithLLM(text, destinations, { apiKey, model = 'llama-3.3-70b-versatile', fetchImpl = fetch } = {}) {
  const res = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }] }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`LLM parser failed (${res.status})`);
  const out = JSON.parse((await res.json()).choices[0].message.content);
  const notes = (out.unclear ?? []).map((u) => `Unclear: ${u}`);
  const payees = {};
  for (const [id, p] of Object.entries(out.payees ?? {})) {
    const pid = slug(id);
    payees[pid] = { label: String(p.label ?? id).slice(0, 60), dest: destinations[pid] ?? { type: 'demo_wallet', value: pid } };
    if (!destinations[pid]) notes.push(`No destination set for "${p.label ?? id}"; using test wallet "${pid}".`);
  }
  const fix = (id) => slug(id);
  const legs = (out.legs ?? []).map((l) => (l.kind === 'by_weight' ? { ...l, payees: (l.payees ?? []).map(fix) } : { ...l, payee: fix(l.payee ?? '') }));
  return { rule: { version: RULE_VERSION, name: String(out.name ?? 'My payout rule').slice(0, 80), payees, legs }, notes, parsed_by: `LLM (${model})` };
}

export async function propose(text, { destinations = {}, name, llm = null } = {}) {
  let result = null;
  let fellBack = null;
  if (llm?.apiKey) {
    try { result = await parseWithLLM(text, destinations, llm); } catch (e) { fellBack = e.message; }
  }
  result ??= parseWithGrammar(text, destinations, name);
  if (fellBack) result.notes.push(`${fellBack}; used the built-in parser instead.`);
  const v = validateRule(result.rule);
  return { ...result, valid: v.ok, errors: v.errors };
}
