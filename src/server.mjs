// Owner console: runs next to the wallet, bound to this computer only.
// Serves the console (web/) and a local copy of the public proof page (public/).
import 'dotenv/config';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { Store } from './store.mjs';
import { SignedLog } from './log.mjs';
import { Engine } from './engine.mjs';
import { decode, loadWallets, makeChecker, makeResolver } from './wallets.mjs';
import { propose } from './parser.mjs';
import { describeRule } from './rule.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const wallets = loadWallets();
const store = new Store('data/state.json');
const log = new SignedLog({ store, keyFile: 'data/nostr.key', publish: process.env.NO_PUBLISH !== '1' && !process.argv.includes('--no-publish') });
const engine = new Engine({ store, log, listener: wallets.listener, payer: wallets.payer, resolver: makeResolver(wallets), decode, check: makeChecker(wallets) });
const llm = process.env.GROQ_API_KEY ? { apiKey: process.env.GROQ_API_KEY } : null;
const destinations = Object.fromEntries(wallets.demoHandles.filter((h) => h !== 'buyer').map((h) => [h, { type: 'demo_wallet', value: h }]));

// Keep the public snapshot file in step with the log.
let exported = -1;
function exportSnapshot() {
  if (exported === log.entries.length) return;
  mkdirSync('public', { recursive: true });
  writeFileSync('public/proof-data.json', JSON.stringify(log.snapshot()));
  exported = log.entries.length;
}

// Wallet numbers are refreshed in the background and cached, so a slow relay never stalls the console.
let walletInfo = { balance_sats: null, payer_budget: null };
let refreshing = false;
const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function refreshWallet() {
  if (refreshing) return;
  refreshing = true;
  try {
    try { walletInfo.balance_sats = Math.floor((await within(wallets.listener.getBalance(), 8000)).balance / 1000); } catch { /* keep the last known value */ }
    try {
      const b = await within(wallets.payer.getBudget(), 8000);
      if (b?.total_budget != null) walletInfo.payer_budget = { used_sats: Math.floor(b.used_budget / 1000), total_sats: Math.floor(b.total_budget / 1000), renewal: b.renewal_period };
    } catch { /* keep the last known value */ }
  } finally { refreshing = false; }
}
const wallet = async () => walletInfo;

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 100_000) { reject(new Error('too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('bad json')); } });
});

const routes = {
  'GET /api/state': async () => {
    const d = store.data;
    return {
      network: 'signet', pubkey: log.pubkey, relays: log.relays, parser: llm ? 'LLM + built-in grammar' : 'built-in grammar',
      wallet: await wallet(), demo_handles: wallets.demoHandles,
      rule: d.rule && { ...d.rule, plain: describeRule(d.rule.rule) },
      deliveries: d.deliveries,
      open_invoices: Object.entries(d.invoices).filter(([h]) => !d.sales[h]).map(([h, i]) => ({ payment_hash: h, ...i })).slice(-5),
      sales: Object.values(d.sales).sort((a, b) => (a.received_at < b.received_at ? 1 : -1)).slice(0, 12),
      log_entries: log.entries.length, published: log.entries.filter((r) => r.relays.length).length,
    };
  },
  'POST /api/rule/propose': async ({ text, name }) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw bad('Write the rule in a sentence or two.');
    const p = await propose(text, { destinations, llm, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : undefined });
    return { ...p, plain: p.valid ? describeRule(p.rule) : [] };
  },
  'POST /api/rule/adopt': async ({ rule, source_text, parsed_by }) => engine.adoptRule(rule, { source_text: String(source_text ?? '').slice(0, 2000), parsed_by: String(parsed_by ?? 'unknown').slice(0, 60) }),
  'POST /api/deliveries': async ({ period, entries }) => engine.recordDeliveries(period, entries),
  'POST /api/sale': async ({ sats, note }) => engine.createSale(Number(sats), String(note ?? '')),
  'POST /api/demo/pay': async ({ payment_hash }) => {
    // Demo only: a test "buyer" wallet pays the sale invoice, standing in for a customer.
    const inv = store.data.invoices[payment_hash];
    if (!inv) throw bad('Unknown invoice.');
    await wallets.demo.buyer.payInvoice({ invoice: inv.invoice });
    return { ok: true };
  },
  'POST /api/sale/retry': async ({ payment_hash }) => { await engine.retry(payment_hash); return { ok: true }; },
};
function bad(message) { return Object.assign(new Error(message), { status: 400 }); }

const server = createServer(async (req, res) => {
  try {
    // Local only: reject DNS-rebinding and cross-site requests.
    const host = (req.headers.host ?? '').split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host)) return json(res, 403, { error: 'local only' });
    const url = new URL(req.url, 'http://x');
    const key = `${req.method} ${url.pathname}`;
    if (routes[key]) {
      if (req.method === 'POST') {
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'json only' });
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'cross-site request refused' });
      }
      const out = await routes[key](req.method === 'POST' ? await readBody(req) : {});
      exportSnapshot();
      return json(res, 200, out);
    }
    if (req.method !== 'GET') return json(res, 404, { error: 'not found' });
    const isProof = url.pathname === '/proof' || url.pathname.startsWith('/proof/');
    const isShell = url.pathname.startsWith('/shell/');
    const base = isProof || isShell ? 'public' : 'web';
    let rel = isProof ? url.pathname.replace(/^\/proof\/?/, '') : url.pathname.replace(/^\//, '');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(ROOT, base, rel));
    if (!file.startsWith(normalize(join(ROOT, base)))) return json(res, 403, { error: 'no' });
    if (!existsSync(file)) return json(res, 404, { error: 'not found' });
    // Only this machine and the project's own pages may frame the console (clickjacking protection).
    const frame = { 'content-security-policy': "frame-ancestors 'self' https://mandate-proof.ibnweb3lab.workers.dev https://*.framer.app https://*.framer.website https://*.framer.com https://framer.com" };
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', ...(extname(file) === '.html' ? frame : {}) });
    res.end(readFileSync(file));
  } catch (e) {
    json(res, e.status ?? (e.code === 'INVALID_RULE' || e.code?.startsWith?.('BAD_') || e.code === 'NO_RULE' ? 400 : 500), { error: e.message, errors: e.errors });
  }
});

// Listen for sales; catch up on any that landed while we were offline.
let unsub = null;
async function listen() {
  unsub = await wallets.listener.subscribeNotifications((n) => { engine.handlePayment(n).then(() => { exportSnapshot(); refreshWallet(); }); }, ['payment_received']);
  await engine.catchUp();
  await engine.resumeUnfinished();
  await log.republishPending();
  exportSnapshot();
}
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mandate owner console: http://localhost:${PORT}   (signet test network)`);
  console.log(`Public proof page, local copy: http://localhost:${PORT}/proof/`);
  console.log(`Log signing key (public): ${log.pubkey}`);
  console.log(`Rule parser: ${llm ? 'LLM + built-in grammar' : 'built-in grammar (set GROQ_API_KEY in .env to add an LLM)'}`);
  listen().catch((e) => console.error('listen failed:', e?.message ?? e));
});
refreshWallet(); setInterval(refreshWallet, 4000).unref();
setInterval(() => log.republishPending().then(exportSnapshot).catch(() => {}), 60_000).unref();
process.on('SIGINT', () => { try { unsub?.(); wallets.close(); } finally { process.exit(0); } });
