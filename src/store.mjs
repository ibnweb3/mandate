// Tiny JSON-file store. One process owns it; every change is written atomically
// (temp file + rename) so a crash never leaves half a file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const EMPTY = () => ({
  rule: null,        // { rule, hash, adopted_at, source_text, parsed_by }
  deliveries: null,  // { period, entries: {payee: kg}, hash, recorded_at }
  invoices: {},      // payment_hash -> { amount_sats, note, created_at }
  sales: {},         // payment_hash -> sale record (see engine.mjs)
  ignored: {},       // payment_hash -> why it was not treated as a sale
  log: [],           // [{ entry, event, relays: [urls that accepted it] }]
});

export class Store {
  constructor(path) {
    this.path = path;
    this.data = EMPTY();
    if (existsSync(path)) this.data = { ...EMPTY(), ...JSON.parse(readFileSync(path, 'utf8')) };
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }
}
