// GATE 2: does the wallet push a payment_received event when a sale lands?
// Run it, then pay the printed invoice from ANY other Lightning wallet.
import { client, sats, describeError } from './_client.mjs';

const AMOUNT_SATS = Number(process.env.GATE2_SATS ?? 21);
const WAIT_MS = 5 * 60 * 1000;
const nwc = client('NWC_URL');
let unsub;
try {
  let wantedHash = null; // only accept the event for the invoice we create below
  const got = new Promise((resolve) => {
    nwc
      .subscribeNotifications((n) => {
        if (n.notification_type !== 'payment_received') return;
        if (wantedHash && n.notification.payment_hash === wantedHash) resolve(n.notification);
        else console.log(`(ignored unrelated event: ${sats(n.notification.amount)} sats)`);
      }, ['payment_received'])
      .then((u) => (unsub = u))
      .catch((e) => {
        console.log('GATE 2 FAIL: subscribe error ->', describeError(e));
        resolve(null);
      });
  });

  await new Promise((r) => setTimeout(r, 2500)); // subscribe BEFORE creating the invoice
  const tx = await nwc.makeInvoice({ amount: AMOUNT_SATS * 1000, description: 'Mandate gate 2' });
  wantedHash = tx.payment_hash;
  console.log(`Pay this ${AMOUNT_SATS}-sat invoice from another wallet within 5 minutes:\n`);
  console.log(tx.invoice, '\n');

  const timeout = new Promise((r) => setTimeout(() => r('timeout'), WAIT_MS));
  const result = await Promise.race([got, timeout]);
  if (result === 'timeout') console.log('GATE 2 FAIL: no payment_received event within 5 minutes');
  else if (result === null) process.exitCode = 1;
  else console.log(`GATE 2 PASS: event received, amount ${sats(result.amount)} sats, hash ${String(result.payment_hash).slice(0, 12)}...`);
} catch (e) {
  console.log('GATE 2 FAIL:', describeError(e));
  process.exitCode = 1;
} finally {
  if (unsub) unsub();
  nwc.close();
}
