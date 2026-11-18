// Wallet glue: loads the connections from data/wallets.json, never logs a secret.
import { existsSync, readFileSync } from 'node:fs';
import { NWCClient } from '@getalby/sdk';
import { Invoice } from '@getalby/lightning-tools/bolt11';
import { LightningAddress } from '@getalby/lightning-tools/lnurl';

export function loadWallets(path = 'data/wallets.json') {
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run: node scripts/setup-wallets.mjs`);
  const w = JSON.parse(readFileSync(path, 'utf8'));
  const mk = (nwc) => new NWCClient({ nostrWalletConnectUrl: nwc });
  const demo = Object.fromEntries(Object.entries(w.demo ?? {}).map(([k, v]) => [k, mk(v.nwc)]));
  return {
    listener: mk(w.listener.nwc),
    payer: mk(w.payer.nwc),
    payerBudgetSats: w.payer.budget_sats ?? null,
    demo,
    demoHandles: Object.keys(demo),
    close() { for (const c of [this.listener, this.payer, ...Object.values(demo)]) try { c.close(); } catch { /* already closed */ } },
  };
}

export const decode = (bolt11) => {
  const inv = new Invoice({ pr: bolt11 });
  return { paymentHash: inv.paymentHash, satoshi: inv.satoshi };
};

// Ask the payee's wallet for an invoice of exactly `sats`.
export function makeResolver(wallets) {
  return async (payee, sats, memo) => {
    const d = payee.dest;
    if (d.type === 'demo_wallet') {
      const c = wallets.demo[d.value];
      if (!c) throw Object.assign(new Error(`No test wallet "${d.value}"`), { code: 'NO_DEST', final: true });
      const tx = await c.makeInvoice({ amount: sats * 1000, description: memo.slice(0, 100) });
      return tx.invoice;
    }
    const ln = new LightningAddress(d.value);
    await ln.fetch();
    const inv = await ln.requestInvoice({ satoshi: sats, comment: memo.slice(0, 100) });
    return inv.paymentRequest;
  };
}
