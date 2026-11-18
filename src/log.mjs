// Tamper-evident log. Every entry carries the hash of the one before it (a chain) and is
// signed as a Nostr event, then published to public relays. Anyone can fetch the events
// and re-check signatures, the chain and the arithmetic, with no wallet and no login.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { canonical, hashOf } from './rule.mjs';

export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
export const GENESIS = '0'.repeat(64);
export const NETWORK = 'signet';

export class SignedLog {
  constructor({ store, keyFile, relays = DEFAULT_RELAYS, publish = true }) {
    this.store = store;
    this.relays = relays;
    this.doPublish = publish;
    if (existsSync(keyFile)) this.sk = hexToBytes(readFileSync(keyFile, 'utf8').trim());
    else {
      this.sk = generateSecretKey();
      mkdirSync(dirname(keyFile), { recursive: true });
      writeFileSync(keyFile, bytesToHex(this.sk), { mode: 0o600 });
    }
    this.pubkey = getPublicKey(this.sk);
  }

  get entries() { return this.store.data.log; }
  get headId() { return this.entries.length ? this.entries.at(-1).entry.id : GENESIS; }

  async append(type, data) {
    const body = { v: 1, net: NETWORK, seq: this.entries.length, ts: Math.floor(Date.now() / 1000), type, data, prev: this.headId };
    const entry = { ...body, id: await hashOf(body) };
    const event = finalizeEvent({
      kind: 1,
      created_at: entry.ts,
      tags: [['t', 'mandate'], ['alt', `Mandate signet test log entry #${entry.seq}: ${type}`]],
      content: canonical(entry),
    }, this.sk);
    const row = { entry, event, relays: [] };
    this.entries.push(row);
    this.store.save();
    if (this.doPublish) this.publishRow(row).catch(() => {});
    return entry;
  }

  async publishRow(row) {
    await Promise.all(this.relays.map(async (url) => {
      if (row.relays.includes(url)) return;
      try {
        const relay = await Relay.connect(url);
        try {
          await Promise.race([relay.publish(row.event), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
          row.relays.push(url);
        } finally { relay.close(); }
      } catch { /* relay down or refused: retried by republishPending */ }
    }));
    this.store.save();
  }

  async republishPending() {
    for (const row of this.entries) if (this.doPublish && row.relays.length === 0) await this.publishRow(row);
  }

  // Everything a stranger needs to verify, bundled as a static file the proof page can also read.
  snapshot() {
    return { pubkey: this.pubkey, network: NETWORK, generated_at: new Date().toISOString(), events: this.entries.map((r) => r.event) };
  }
}
