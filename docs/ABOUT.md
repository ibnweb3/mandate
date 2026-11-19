## Inspiration

Picture a group of farmers who sell shea butter together. A buyer pays once, in one lump. Then someone has to work out who is owed what and pay every farmer, usually by hand, usually late, and always on trust. Twelve people are waiting, and each one is asking the same quiet question: *how much of it is mine?*

The same problem shows up in other places. A trader who owes a supplier has to remember to hand over a slice of every sale until the debt is cleared. In both cases the person holding the money is also the person everyone has to believe.

We wanted to remove that belief from the process. **Write the rule once, in plain words, and let the payment network do the rest, with proof anyone can check.**

## What it does

**Mandate** turns a sentence into automatic payouts over Bitcoin Lightning.

> "10% of each sale goes to Coop. Split the rest between Amadou, Fatou and Ousmane by kg delivered."
>
> "20% of each sale goes to my supplier until 500,000 sats are repaid."

1. An AI (or a built-in reader) only **proposes** a rule. Mandate shows it back in plain English and you confirm it. After that the AI is out of the picture.
2. A sale arrives as a Lightning invoice.
3. Plain, deterministic code splits it by the confirmed rule and pays every person over Lightning in seconds. It pays each farmer their share, and it repays the supplier's debt from every sale, stopping when the cap is reached.
4. The payout connection has a spending budget that **the wallet itself enforces**. Even a bug in our code cannot pay out more.
5. Every step is signed and published on Nostr. A public proof page, with no wallet and no login, re-checks every signature, every link in the chain, the split arithmetic and every Lightning receipt, right in the visitor's browser.

In the demo, a 3,000-sat sale goes out: the co-op and one farmer are paid, then the wallet **refuses** the next two payouts because the weekly budget is used up. The engine writes the refusal down instead of finding a way around it, and the proof page shows those payouts as refused.

## Why Bitcoin Lightning is central

Mandate needs four things at once, and Lightning with Nostr gives all of them:

- **Instant, tiny payments**, so a farmer is paid per sale, not at the end of the week.
- **A receipt that cannot be faked.** The payment preimage hashes to the invoice, and our proof page checks that for every payout.
- **A spending limit enforced by the wallet**, through a Nostr Wallet Connect connection with a budget. Our security claim rests on the wallet, not on our code.
- **A public, tamper-evident record**, as hash-chained entries signed with a Nostr key and published to public relays.

Take any one away and Mandate becomes a spreadsheet with a promise.

## How we built it

- **Rule engine.** The rule schema and the split arithmetic are pure functions in one file, shared by the engine and the browser, so the proof page redoes the exact same maths. Amounts are whole sats. For a sale \\( S \\) shared by weights \\( w_i \\) from a pool \\( P \\), each payee gets \\( \lfloor P\,w_i / W \rfloor \\) and the leftover sats go to the largest remainders, so that always

  $$\sum_i p_i + k = S$$

  where \\( p_i \\) are the payouts and \\( k \\) is what the owner keeps. We property-tested this over hundreds of random sales.
- **Wallet.** Alby Hub (LDK, on the signet test network) with two Nostr Wallet Connect connections: a *listener* that can make invoices and hear payments but cannot spend, and a *payer* that can only pay, with a budget the wallet enforces.
- **Safety rules in the engine.** The plan is written to the signed log **before** any sat moves. Sales are deduplicated by payment hash, because notifications can replay. The engine decodes every payee invoice and refuses one whose amount differs from what the rule computed.
- **Proof.** `nostr-tools` signs and publishes. One verifier file runs in Node (tests) and in the browser (proof page). It trusts nothing the engine says.
- **Interface.** The Nostalgia Computer template remixed in Framer: a retro desktop where every page opens like a file. The Console window shows the real console, and the Proof window shows the public proof page. A small Cloudflare Worker serves the desktop and the project's own pages.
- **Tests.** 27 automated tests cover the rule maths, the engine (replayed notifications, budget refusals, wrong-amount invoices), the parser, the verifier and tamper detection.

## Challenges we ran into

- **Making "the AI proposes, code decides" real.** A parser can misread. So the validator rejects anything over 100% or unknown, and the owner always confirms the rule in plain English. The AI never sees a sale.
- **Replayed notifications.** Our first receive test passed on an unrelated payment. We now match the exact invoice hash and ignore anything already processed.
- **No public Lightning-address service on signet.** In the demo the farmers' "addresses" are test wallets on the same hub. The real Lightning-address path is built but not yet run.
- **Flaky relays and wallet round trips.** The proof page updates as each relay answers and also carries its own copy of the log, so it still works when one relay is slow.
- **Keeping the wallet connection off the internet.** The owner console runs on the owner's own computer, next to the wallet. We did not host it. Visitors get the demo video and the public proof page.

## What we learned

The valuable part is not the payment, it is the **proof**. People accept being paid by a rule when they can check the rule, the arithmetic and the receipt themselves. We also learned how much trust a wallet-enforced limit buys: "even our own bug cannot overspend" is a stronger promise than "we are careful".

## What is real and what is a stand-in

Everything runs on the signet test network with **test sats**, not real money. The Lightning payments between wallets, the wallet-enforced budget and its refusals, the Nostr-signed log and the proof page are real. A test wallet plays the buyer, and the farmers' addresses are test wallets on the same hub. We have no real users yet and make no claims about adoption.

## What's next

Run the Lightning-address path on mainnet with a real pilot, with a farmers' group or a small trading group. Add a visible history of rule changes, a phone-friendly owner view, and a hosted option that keeps the wallet connection on the owner's device.

## Built with

Bitcoin, Lightning, Nostr Wallet Connect (NIP-47), Nostr, Alby Hub, Node.js, Cloudflare Workers, Framer, Claude Code, ElevenLabs (demo voice-over).

**Try it:** [live desktop](https://mandate-proof.ibnweb3lab.workers.dev/) · [source code (MIT)](https://github.com/ibnweb3/mandate)
