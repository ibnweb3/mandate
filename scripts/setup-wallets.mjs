// One-time setup on a signet Alby Hub: mints the connections the engine needs and writes
// their secrets to data/wallets.json (git-ignored). Secrets are never printed.
//
//   listener  : can make invoices and hear incoming payments. CANNOT spend.
//   payer     : can only pay invoices, and only up to a budget the wallet itself enforces.
//   demo wallets (test only): one per farmer/supplier plus a buyer. These stand in for real
//               Lightning addresses, which signet does not have.
//
// Usage: node scripts/setup-wallets.mjs            (hub must be running and unlocked)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const HUB = process.env.HUB_URL ?? 'http://localhost:8080';
const FILE = 'data/wallets.json';
const PAYER_BUDGET_SATS = Number(process.env.PAYER_BUDGET_SATS ?? 3000);
const BUYER_FUND_SATS = Number(process.env.BUYER_FUND_SATS ?? 6000);
const DEMO = ['coop', 'amadou', 'fatou', 'ousmane', 'supplier', 'buyer'];

function hub(args) {
  const out = execFileSync('npx', ['-y', '@getalby/hub-cli@0.6.0', '-u', HUB, ...args], {
    encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out.slice(out.indexOf('{')));
}
const secretOf = (j) => j.pairingUri ?? j.nostrWalletConnectUrl ?? j.nostrWalletConnectURL;

mkdirSync('data', { recursive: true });
const wallets = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { demo: {} };
wallets.demo ??= {};
const save = () => writeFileSync(FILE, JSON.stringify(wallets, null, 2));

if (!wallets.listener) {
  const j = hub(['create-app', '--name', 'Mandate-listener-no-spend', '--scopes', 'make_invoice,lookup_invoice,get_info,get_balance,list_transactions,notifications']);
  wallets.listener = { nwc: secretOf(j), appId: j.id };
  save();
  console.log('created listener connection (no spend permission)');
}
if (!wallets.payer) {
  const j = hub(['create-app', '--name', 'Mandate-payer-budget-capped', '--scopes', 'pay_invoice,get_balance,get_info', '--max-amount', String(PAYER_BUDGET_SATS), '--budget-renewal', 'weekly']);
  wallets.payer = { nwc: secretOf(j), appId: j.id, budget_sats: PAYER_BUDGET_SATS };
  save();
  console.log(`created payer connection (budget ${PAYER_BUDGET_SATS} sats per week, enforced by the wallet)`);
}
for (const handle of DEMO) {
  if (wallets.demo[handle]) continue;
  const j = hub(['create-sub-wallet', '--name', `Mandate-demo-${handle}`]);
  wallets.demo[handle] = { nwc: secretOf(j), appId: j.id };
  save();
  console.log(`created demo wallet "${handle}"`);
}
if (!wallets.buyer_funded) {
  hub(['transfer', '--to-app-id', String(wallets.demo.buyer.appId), '--amount', String(BUYER_FUND_SATS)]);
  wallets.buyer_funded = BUYER_FUND_SATS;
  save();
  console.log(`funded demo buyer with ${BUYER_FUND_SATS} sats`);
}
console.log('done. Secrets are in data/wallets.json (git-ignored).');
