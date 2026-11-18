// Owner console. Plain DOM, no framework. All text from the server is escaped before display.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setHtml = (el, html) => { if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } };
const fmt = (n) => (n == null ? 'n/a' : Number(n).toLocaleString('en'));

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || `Request failed (${res.status})`), { errors: out.errors });
  return out;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
function setStatus(id, msg, isErr = false) {
  const el = $(id);
  el.textContent = msg;
  el.classList.toggle('err', isErr);
}

let state = null;
let proposal = null;
let delKey = '';

// ---- step 1: rule ------------------------------------------------------------------------
$('rule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-read');
  btn.disabled = true;
  setStatus('rule-status', 'Reading…');
  try {
    proposal = { ...(await api('/api/rule/propose', { text: $('rule-text').value, name: $('rule-name').value })), text: $('rule-text').value };
    setStatus('rule-status', '');
    renderProposal();
  } catch (err) {
    setStatus('rule-status', err.message, true);
  } finally { btn.disabled = false; }
});

function renderProposal() {
  const box = $('proposal');
  if (!proposal) { box.hidden = true; return; }
  const p = proposal;
  box.hidden = false;
  box.className = 'proposal';
  box.innerHTML = `
    <h3>Here is what I understood <span class="chip ${p.valid ? '' : 'bad'}">${p.valid ? 'Valid' : 'Not usable yet'}</span> <span class="chip warn">Read by ${esc(p.parsed_by)}</span></h3>
    ${p.valid ? `<ol>${p.plain.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}
    ${p.errors?.length ? `<ul class="errors">${p.errors.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${p.notes?.length ? `<ul class="notes">${p.notes.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    <p class="meta">Anything not listed stays in your wallet. If this is not what you meant, edit the sentence and read it again.</p>
    ${p.valid ? '<button class="btn" id="btn-adopt" type="button">Yes, this is my rule</button>' : ''}`;
  $('btn-adopt')?.addEventListener('click', adopt);
}

async function adopt() {
  const btn = $('btn-adopt');
  btn.disabled = true;
  try {
    await api('/api/rule/adopt', { rule: proposal.rule, source_text: proposal.text, parsed_by: proposal.parsed_by });
    proposal = null;
    renderProposal();
    toast('Rule confirmed and signed into the public log');
    await refresh();
  } catch (err) {
    btn.disabled = false;
    toast(err.message);
  }
}

function renderActiveRule() {
  const box = $('rule-active');
  const r = state.rule;
  if (!r) { box.hidden = true; return; }
  box.hidden = false;
  box.className = 'active';
  box.innerHTML = `<strong>${esc(r.rule.name)}</strong> <span class="chip">Active</span>
    <ol>${r.plain.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
    <p class="meta">Rule fingerprint <code>${esc(r.hash.slice(0, 16))}…</code> · read by ${esc(r.parsed_by)} · confirmed by you. To change it, write a new rule below.</p>`;
}

// ---- step 2: deliveries ------------------------------------------------------------------
function renderDeliveries() {
  const r = state.rule;
  const section = $('step-deliveries');
  const members = r ? [...new Set(r.rule.legs.filter((l) => l.kind === 'by_weight').flatMap((l) => l.payees))] : [];
  section.hidden = members.length === 0;
  if (!members.length) return;
  const key = `${r.hash}`;
  if (key === delKey) return; // do not wipe what the owner is typing
  delKey = key;
  const cur = state.deliveries?.entries ?? {};
  $('del-rows').innerHTML = members.map((id) => `
    <div class="del-row"><label for="kg-${esc(id)}">${esc(r.rule.payees[id].label)} (kg)</label>
    <input id="kg-${esc(id)}" data-id="${esc(id)}" type="number" inputmode="decimal" min="0" step="0.1" value="${esc(cur[id] ?? '')}" placeholder="0"></div>`).join('');
}
$('del-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const entries = {};
  document.querySelectorAll('#del-rows input').forEach((i) => { if (i.value !== '') entries[i.dataset.id] = Number(i.value); });
  try {
    await api('/api/deliveries', { period: $('del-period').value, entries });
    setStatus('del-status', 'Saved and signed into the log.');
    await refresh();
  } catch (err) { setStatus('del-status', err.message, true); }
});

// ---- step 3: sales -----------------------------------------------------------------------
$('sale-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('sale-status', 'Creating…');
  try {
    await api('/api/sale', { sats: Number($('sale-sats').value), note: $('sale-note').value });
    setStatus('sale-status', '');
    await refresh();
  } catch (err) { setStatus('sale-status', err.message, true); }
});

function renderOpenInvoices() {
  const el = $('open-invoices');
  setHtml(el, state.open_invoices.map((i) => `
    <div class="invoice" data-h="${esc(i.payment_hash)}">
      <strong>${fmt(i.amount_sats)} sats</strong> · ${esc(i.note || 'Sale')} <span class="chip warn">Waiting for payment</span>
      <code>${esc(i.invoice)}</code>
      <button class="btn ghost small" type="button" data-copy="${esc(i.invoice)}">Copy invoice</button>
      <button class="btn small" type="button" data-pay="${esc(i.payment_hash)}">Pay it as the demo buyer (test only)</button>
    </div>`).join(''));
}
$('open-invoices').addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Invoice copied'); } catch { toast('Copy failed'); } return; }
  const pay = e.target.closest('[data-pay]');
  if (pay) {
    pay.disabled = true;
    pay.textContent = 'Paying…';
    try { await api('/api/demo/pay', { payment_hash: pay.dataset.pay }); toast('Paid. The engine is splitting it now.'); } catch (err) { toast(err.message); pay.disabled = false; pay.textContent = 'Pay it as the demo buyer (test only)'; }
  }
});

const STATE = { paid: ['Paid', ''], pending: ['Paying…', 'warn'], planned: ['Queued', 'warn'], refused: ['Refused by wallet', 'bad'], failed: ['Failed', 'bad'] };
function renderSales() {
  const el = $('sales');
  if (!state.sales.length) { setHtml(el, '<p class="empty">No sales yet. Create an invoice above, then pay it.</p>'); return; }
  const r = state.rule?.rule;
  setHtml(el, state.sales.map((s) => {
    const overall = s.status === 'settled' ? ['Settled', ''] : s.status === 'partial' ? ['Needs attention', 'bad'] : ['Splitting…', 'warn'];
    const rows = s.payouts.map((p) => {
      const [label, cls] = STATE[p.status] ?? [p.status, 'warn'];
      return `<tr><td>${esc(p.label ?? r?.payees[p.payee]?.label ?? p.payee)}</td><td class="num">${fmt(p.sats)}</td><td><span class="chip ${cls}">${label}</span>${p.error ? `<div class="meta">${esc(p.error)}</div>` : ''}</td></tr>`;
    }).join('');
    const kept = s.kept > 0 ? `<tr><td>Kept in your wallet</td><td class="num">${fmt(s.kept)}</td><td><span class="chip">Stays with you</span></td></tr>` : '';
    return `<article class="sale">
      <div class="sale-head"><strong>${fmt(s.amount_sats)} sats</strong><span><span class="chip ${overall[1]}">${overall[0]}</span> <span class="meta">${esc(s.note || '')}${s.period ? ` · ${esc(s.period)}` : ''}</span></span></div>
      <table><thead><tr><th>Who</th><th class="num">Sats</th><th>Status</th></tr></thead><tbody>${rows}${kept}</tbody></table>
      ${s.warnings?.length ? `<ul class="notes">${s.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="row">${s.status === 'partial' ? `<button class="btn small" type="button" data-retry="${esc(s.payment_hash)}">Retry unpaid payouts</button>` : ''}
      <a class="meta" href="/proof/#sale=${esc(s.payment_hash)}" target="_blank" rel="noopener">Check this sale on the public proof page</a></div>
    </article>`;
  }).join(''));
}
$('sales').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-retry]');
  if (!b) return;
  b.disabled = true;
  try { await api('/api/sale/retry', { payment_hash: b.dataset.retry }); } catch (err) { toast(err.message); }
  b.disabled = false;
});

// ---- header + polling --------------------------------------------------------------------
function renderHeader() {
  $('st-balance').textContent = state.wallet.balance_sats == null ? 'unavailable' : `${fmt(state.wallet.balance_sats)} sats`;
  const b = state.wallet.payer_budget;
  $('st-budget').textContent = b ? `${fmt(b.used_sats)} / ${fmt(b.total_sats)} sats per ${b.renewal === 'never' ? 'lifetime' : b.renewal.replace(/ly$/, '')}` : 'unavailable';
  $('pubkey').textContent = `${state.pubkey.slice(0, 12)}…${state.pubkey.slice(-6)}`;
  $('log-count').textContent = `${state.log_entries} log entries, ${state.published} published to relays.`;
  $('demo-handles').textContent = state.demo_handles.filter((h) => h !== 'buyer').join(', ');
  $('step-sale').hidden = !state.rule;
}

async function refresh() {
  try {
    state = await api('/api/state');
    renderHeader();
    renderActiveRule();
    renderDeliveries();
    renderOpenInvoices();
    renderSales();
  } catch (err) { $('st-balance').textContent = 'engine offline'; }
}
await refresh();
setInterval(refresh, 1500);
