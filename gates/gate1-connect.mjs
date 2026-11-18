// GATE 1: can we talk to the wallet over NWC, and what does it support?
import { client, sats, describeError } from './_client.mjs';

const nwc = client('NWC_URL');
try {
  const info = await nwc.getInfo();
  console.log('alias        :', info.alias);
  console.log('network      :', info.network);
  console.log('methods      :', (info.methods ?? []).join(', '));
  console.log('notifications:', (info.notifications ?? []).join(', ') || '(none listed)');

  const bal = await nwc.getBalance();
  console.log('balance sats :', sats(bal.balance));

  try {
    const b = await nwc.getBudget();
    console.log('budget       :', JSON.stringify(b));
  } catch (e) {
    console.log('budget       : getBudget not available ->', describeError(e));
  }

  const need = ['make_invoice', 'pay_invoice', 'lookup_invoice'];
  const missing = need.filter((m) => !(info.methods ?? []).includes(m));
  console.log(missing.length ? `GATE 1 FAIL: missing methods ${missing}` : 'GATE 1 PASS');
} catch (e) {
  console.log('GATE 1 FAIL:', describeError(e));
  process.exitCode = 1;
} finally {
  nwc.close();
}
