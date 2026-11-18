// Shared helper for the Day-1 gate scripts. Never prints connection strings.
import 'dotenv/config';
import { NWCClient } from '@getalby/sdk';

export function client(envName = 'NWC_URL') {
  const url = process.env[envName];
  if (!url) {
    console.error(`Missing ${envName} in .env (see .env.example).`);
    process.exit(2);
  }
  return new NWCClient({ nostrWalletConnectUrl: url });
}

export const sats = (msats) => Math.floor(Number(msats) / 1000);

export function describeError(e) {
  return `${e?.constructor?.name ?? 'Error'} code=${e?.code ?? '-'} message=${e?.message ?? e}`;
}

// A recipient wallet (e.g. one farmer's sub-wallet) issues an invoice for `amountSats`.
// Signet has no public LNURL server, so the gates pay a real invoice instead of a Lightning address.
export async function payeeInvoice(amountSats, description = 'Mandate gate payout') {
  const payee = client('PAYEE_SUBWALLET_NWC_URL');
  try {
    const tx = await payee.makeInvoice({ amount: amountSats * 1000, description });
    return tx.invoice;
  } finally {
    payee.close();
  }
}
