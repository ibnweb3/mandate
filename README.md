# Mandate

**Write a payout rule once, in plain words. Lightning pays everyone. The wallet itself refuses to overspend.**

Built for the Dakar Bitcoin Hack 2026. Everything runs on the **signet test network** (test sats, no real money).

## The 10-second story

Mama Aïssatou runs a shea-butter co-op. A buyer pays one Lightning invoice. Her rule says: *"10% to the co-op, split the rest between Amadou, Fatou and Ousmane by kg delivered."* The moment the sale lands, each farmer is paid in seconds. Nobody keeps a spreadsheet, nobody waits for a Friday payout, and nobody has to trust the person holding the money.

The same engine runs a trader's supplier deal: *"20% of each sale goes to my supplier until 500,000 sats are repaid."*

## Why you can trust it (and what you do not have to)

| Layer | What it does | What it cannot do |
|---|---|---|
| **AI** | Reads the sentence and *proposes* a rule. | It never sees a sale, never touches money, never decides an amount. You read the proposal in plain English and confirm it. |
| **Code** (`src/rule.mjs`) | Pure, deterministic arithmetic. Same input, same output. No sat is lost or invented (property-tested). | It cannot pay more than the rule allows. |
| **Wallet budget** | The payer connection is a Nostr Wallet Connect link with a spending budget **enforced by the wallet** (Alby Hub), not by our code. | Even if our engine is hacked or buggy, the wallet answers `QUOTA_EXCEEDED`. Gate 4 proves it. |
| **Listener connection** | Hears incoming payments and mints invoices. | It has no permission to spend. |
| **Signed log** | Every step (rule, deliveries, plan, each payout, each refusal) is a hash-chained Nostr event signed by the engine key and published to public relays. The plan is logged **before** any sat moves. | It cannot be edited or trimmed without breaking the chain. |
| **Proof page** (`public/`) | Anyone, with no wallet and no login, re-checks signatures, the chain, the split arithmetic and every Lightning proof of payment (the preimage must hash to the invoice) in their own browser. | It trusts nothing the engine says. It uses the same `rule.mjs` and `verify.mjs`. |

The proof page has a **Try to cheat** button that alters one payout in your own copy and shows the check failing.

## What is real, and what is a stand-in

- **Real:** the Lightning payments between wallets on a signet Alby Hub (LDK node), the wallet-enforced budget, the Nostr-signed log, the proof page.
- **Stand-in:** signet has no public Lightning-address service, so in the demo the farmers' "addresses" are sub-wallets on the same hub (`demo_wallet` payees). The `lightning_address` payee type is implemented (LNURL-pay via `@getalby/lightning-tools`) but **has not been exercised on signet**. It needs a real-money run to prove.
- **Sales are invoices the engine mints.** Only payments to those invoices are split. Other incoming money (top-ups, refunds) is ignored on purpose.
- **Rule parser:** a built-in grammar handles the common sentences offline. If `GROQ_API_KEY` is set, an LLM is tried first; if it fails, the grammar takes over. Every proposal says which one read it. Anything it cannot understand is reported, never guessed.
- **Not built:** multi-currency (everything is in sats), editing history of rules beyond the log, a hosted version of the owner console (it runs next to the wallet, on your own computer).

## Run it

Needs Node 22+ and an Alby Hub on signet (see `scripts/setup-wallets.mjs`).

```bash
npm install
npm run setup       # mints the listener, budget-capped payer and demo wallets into data/wallets.json (git-ignored)
npm start           # owner console at http://localhost:8787, public proof page at /proof/
npm test            # 27 tests: rule maths, engine, parser, verifier, tamper detection
```

`npm run dev` does the same without publishing to Nostr relays.

Day-1 gate scripts (`npm run gate1` to `gate4`) check the wallet end to end: connect, receive event, pay, and budget refusal.

## Layout

```
src/rule.mjs      rule schema, validator, split arithmetic (pure; shared with the browser)
src/engine.mjs    receive, dedupe, plan, pay, retry
src/parser.mjs    plain words -> proposed rule (grammar + optional LLM)
src/log.mjs       hash-chained, Nostr-signed log
src/verify.mjs    independent verifier (runs in Node and in the browser)
src/server.mjs    owner console (127.0.0.1 only)
web/              owner console UI
public/           the public proof page (static, deployable anywhere)
test/             node:test suites
```

## Threat model, briefly

- *The AI misreads the rule:* you confirm it in plain English first; the validator rejects anything over 100% or unknown.
- *A payee's wallet returns an invoice for the wrong amount:* the engine decodes it and refuses unless it matches the rule exactly.
- *A notification is replayed:* sales are deduplicated by payment hash, so nobody is paid twice.
- *The engine is compromised:* the wallet's budget caps the loss. The listener connection cannot spend at all.
- *The operator rewrites history:* the proof page detects missing, altered or reordered entries.
- *Not covered:* a compromised owner machine can still adopt a malicious rule (it is signed and public, but it is the owner's rule). Key management for the signing key is a plain file.

## AI disclosure

Built with Claude Code (Anthropic). The AI wrote much of the code under the author's direction; the design, the rules above and the test cases were reviewed by the author. The product's own AI is limited to proposing a rule from a sentence.

## License

MIT
