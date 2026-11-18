// GATE 4 (the one that matters): does the wallet itself refuse to overspend?
// Uses NWC_CAPPED_URL: a SECOND connection created with a tiny budget (10 sats, no renewal).
// Step A pays 4 sats (must succeed). Step B tries 9 sats (must be refused, QUOTA_EXCEEDED).
import { client, payeeInvoice, describeError } from './_client.mjs';

const nwc = client('NWC_CAPPED_URL');

async function tryPay(sats) {
  const invoice = await payeeInvoice(sats);
  return nwc.payInvoice({ invoice });
}

try {
  try {
    console.log('budget:', JSON.stringify(await nwc.getBudget()));
  } catch (e) {
    console.log('budget: not readable ->', describeError(e));
  }
  let a = false;
  try {
    await tryPay(4);
    a = true;
    console.log('Step A (4 sats, inside cap): paid');
  } catch (e) {
    console.log('Step A FAILED unexpectedly ->', describeError(e));
  }
  let refused = false;
  let detail = '';
  try {
    await tryPay(9);
    detail = 'paid, which means the cap did NOT hold';
  } catch (e) {
    refused = true;
    detail = describeError(e);
  }
  console.log('Step B (9 sats, over cap):', detail);
  console.log(a && refused ? 'GATE 4 PASS: wallet enforced the cap' : 'GATE 4 FAIL');
  if (!(a && refused)) process.exitCode = 1;
} finally {
  nwc.close();
}
