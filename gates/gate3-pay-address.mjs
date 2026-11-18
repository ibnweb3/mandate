// GATE 3: can the engine pay a recipient wallet (a farmer / a supplier) by itself?
// The recipient (a separate sub-wallet) issues an invoice; the engine wallet pays it.
import { client, payeeInvoice, describeError } from './_client.mjs';

const amount = Number(process.env.GATE3_SATS ?? 2);
const nwc = client('NWC_URL');
try {
  const invoice = await payeeInvoice(amount);
  const res = await nwc.payInvoice({ invoice });
  console.log(res.preimage ? 'GATE 3 PASS: paid, preimage returned' : 'GATE 3 FAIL: no preimage returned');
  console.log('fees paid (msats):', res.fees_paid ?? 'n/a');
} catch (e) {
  console.log('GATE 3 FAIL:', describeError(e));
  process.exitCode = 1;
} finally {
  nwc.close();
}
