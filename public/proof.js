// Public proof page. Everything is re-derived here in the browser from signed events.
import { verifyEvent, npubEncode } from './lib/nostr.js';
import { verifyLog } from './lib/verify.mjs';
import { describeRule } from './lib/rule.mjs';

const RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en');
const short = (h, n = 10) => `${String(h).slice(0, n)}…`;

function fetchRelay(url, pubkey, ms = 7000) {
  return new Promise((resolve) => {
    const events = [];
    let ws;
    const done = () => { try { ws?.close(); } catch { /* ignore */ } resolve(events); };
    const timer = setTimeout(done, ms);
    try {
      ws = new WebSocket(url);
      ws.onopen = () => ws.send(JSON.stringify(['REQ', 'mandate', { kinds: [1], authors: [pubkey], '#t': ['mandate'], limit: 500 }]));
      ws.onmessage = (m) => {
        try {
          const [type, , ev] = JSON.parse(m.data);
          if (type === 'EVENT') events.push(ev);
          if (type === 'EOSE') { clearTimeout(timer); done(); }
        } catch { /* ignore malformed relay messages */ }
      };
      ws.onerror = () => { clearTimeout(timer); done(); };
    } catch { clearTimeout(timer); done(); }
  });
}

let events = [];
let sources = [];
let pubkey = '';
let cheated = false;
const target = new URLSearchParams(location.hash.slice(1)).get('sale');

async function load() {
  let snap = null;
  try { snap = await (await fetch(new URL('proof-data.json', import.meta.url), { cache: 'no-store' })).json(); } catch { /* relays only */ }
  pubkey = new URLSearchParams(location.search).get('pk') || snap?.pubkey || '';
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    $('summary').innerHTML = '<p class="empty">No signing key known yet. Nothing has been logged.</p>';
    return;
  }
  $('pubkey').textContent = npubEncode(pubkey);
  const all = new Map();
  if (snap?.events) {
    for (const e of snap.events) all.set(e.id, e);
    sources.push(`this site's copy: ${snap.events.length}`);
    events = [...all.values()];
    if (events.length) {
      await render(); // show this site's copy at once; the relays refine it below
      $('sources').textContent = 'Read from this site\'s copy. Checking the public relays too…';
    }
  }
  // Each relay updates the page as soon as it answers, so nobody waits for the slowest one.
  await Promise.all(RELAYS.map(async (u) => {
    const r = await fetchRelay(u, pubkey, 5000);
    for (const e of r) all.set(e.id, e);
    sources.push(`${u.replace('wss://', '')}: ${r.length}`);
    events = [...all.values()];
    if (!cheated && r.length) await render();
  }));
  events = [...all.values()];
  if (!cheated) await render();
}

async function render(evs = events) {
  const r = await verifyLog(evs, { pubkey, verifySignature: verifyEvent });
  const verifiedSales = r.sales.filter((s) => s.verified).length;
  const allGood = r.logOk && r.problems.length === 0 && r.sales.length > 0 && verifiedSales === r.sales.length;
  const noSales = r.sales.length === 0 && r.logOk;
  $('summary').innerHTML = `
    <div class="verdict ${allGood || noSales ? 'ok' : 'fail'}"><span class="mark" aria-hidden="true">${allGood || noSales ? '✓' : '✗'}</span>
      <span>${noSales ? 'The log is intact. No sales yet.' : allGood ? `Every payout checks out (${r.sales.length} ${r.sales.length === 1 ? 'sale' : 'sales'}).` : 'Something does not check out.'}</span></div>
    <p class="meta">${r.entries.length} signed log entries · chain ${r.logOk ? 'intact' : 'BROKEN'} · ${verifiedSales} of ${r.sales.length} sales fully verified</p>
    ${r.problems.length ? `<ul class="problems">${r.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}`;
  $('sources').textContent = `Read from: ${sources.join(' · ')}. Entries counted only if their signature matches the key below.`;

  $('sales').innerHTML = r.sales.length ? [...r.sales].reverse().map((s) => saleCard(s)).join('') : '<p class="empty">No sales in the log yet.</p>';
  $('log').innerHTML = r.entries.map((e) => `<div class="logrow"><code>#${e.seq}</code><span>${esc(e.type)}</span><code>${esc(short(e.id, 16))}</code></div>`).join('');
  if (target) document.querySelector(`[data-sale="${CSS.escape(target)}"]`)?.scrollIntoView({ block: 'center' });
}

function saleCard(s) {
  const label = (id) => s.rule?.payees[id]?.label ?? id;
  const rows = s.plan.payouts.map((p) => {
    const paid = s.payouts.find((x) => x.payee === p.payee && x.ok);
    const ref = s.refused.find((x) => x.payee === p.payee);
    const cell = paid
      ? `<span class="chip">Paid</span><div class="meta">proof: <code>${esc(short(paid.preimage, 14))}</code> hashes to <code>${esc(short(paid.payment_hash, 14))}</code> ✓</div>`
      : ref ? `<span class="chip bad">${ref.type === 'payout_refused' ? 'Refused by the wallet' : 'Failed'}</span><div class="meta">${esc(ref.error)}</div>`
      : '<span class="chip warn">Not paid yet</span>';
    return `<tr><td>${esc(label(p.payee))}</td><td class="num">${fmt(p.sats)}</td><td>${cell}</td></tr>`;
  }).join('');
  const kept = s.plan.kept > 0 ? `<tr><td>Kept by the owner</td><td class="num">${fmt(s.plan.kept)}</td><td><span class="chip">Stays with the owner</span></td></tr>` : '';
  return `<article class="sale ${s.payment_hash === target ? 'target' : ''}" data-sale="${esc(s.payment_hash)}">
    <div class="sale-head"><strong>${fmt(s.amount_sats)} sats</strong>
      <span><span class="chip ${s.verified ? '' : 'bad'}">${s.verified ? 'Verified' : 'Does not verify'}</span> <span class="meta">${new Date(s.ts * 1000).toLocaleString()}${s.period ? ` · ${esc(s.period)}` : ''}</span></span></div>
    ${s.rule ? `<ol class="rule">${describeRule(s.rule).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}
    <table><thead><tr><th>Who</th><th class="num">Sats</th><th>Result</th></tr></thead><tbody>${rows}${kept}</tbody></table>
    <details ${s.verified ? '' : 'open'}><summary>What was checked</summary>
      <ul class="checks">${s.checks.map((c) => `<li class="${c.ok ? '' : 'bad'}">${esc(c.text)}</li>`).join('')}</ul>
      <p class="meta">Sale payment hash <code>${esc(s.payment_hash)}</code></p></details>
  </article>`;
}

$('btn-cheat').addEventListener('click', async () => {
  const i = events.findIndex((e) => { try { return JSON.parse(e.content).type === 'payout_sent'; } catch { return false; } });
  if (i < 0) { $('cheat-out').innerHTML = '<p class="meta">There is no payout in the log to alter yet.</p>'; return; }
  const forged = JSON.parse(JSON.stringify(events));
  const body = JSON.parse(forged[i].content);
  const old = body.data.sats;
  body.data.sats = old + 100;
  forged[i].content = JSON.stringify(body); // the signature no longer matches this content
  cheated = true;
  $('btn-reset').hidden = false;
  $('cheat-out').innerHTML = `<p class="meta">Changed one payout from ${fmt(old)} to ${fmt(old + 100)} sats in your copy. The page now shows what the check says.</p>`;
  await render(forged);
  $('summary').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});
$('btn-reset').addEventListener('click', async () => {
  cheated = false;
  $('btn-reset').hidden = true;
  $('cheat-out').innerHTML = '';
  await render();
});

await load();
