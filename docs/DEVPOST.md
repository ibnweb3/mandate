# Mandate: Devpost submission text (Dakar Bitcoin Hack 2026)

Links to paste
- Live site (the desktop): https://mandate-proof.ibnweb3lab.workers.dev/
- Demo video: upload docs/demo/mandate-demo.mp4 to YouTube or Vimeo and paste the link (the same video also plays in the site's Demo window)
- Source code (public, MIT): https://github.com/ibnweb3/mandate

## Tagline (one line)
Write a payout rule once, in plain words. Bitcoin Lightning pays everyone, and the wallet itself refuses to overspend.

## Inspiration
Picture a shea-butter co-op. A buyer pays once, in one lump. Then someone has to work out who is owed what and pay every farmer, usually by hand, usually late, and always on trust. The same problem shows up wherever one payment has to be shared: a trader repaying a supplier out of every sale, a market-women's group, a driver collective. The person holding the money is also the person everyone has to believe. We wanted to remove that belief from the process.

## What it does
You write the payout rule in a sentence, for example: "10% of each sale goes to Coop. Split the rest between Amadou, Fatou and Ousmane by kg delivered."
1. An AI (or a built-in reader) only proposes a rule. Mandate shows it back in plain English and you confirm it. After that the AI is out of the picture.
2. A sale arrives as a Lightning invoice.
3. Plain, deterministic code splits it by the confirmed rule and pays each person over Lightning, in seconds. No sat is lost or invented.
4. The payout connection has a spending budget that the wallet itself enforces. If our engine had a bug, the wallet would still refuse to pay out more.
5. Every step is signed and published on Nostr. A public proof page, with no wallet and no login, re-checks every signature, the chain of entries, the split arithmetic and every Lightning proof of payment, in the visitor's own browser. It has a "try to cheat" button that alters one payout and shows the check fail.

The same engine runs a trader's supplier deal: "20% of each sale goes to my supplier until 500,000 sats are repaid." It stops at the cap.

## Why Bitcoin Lightning is central (not decoration)
Mandate needs four things at once, and Lightning with Nostr gives all four:
- Instant, tiny payments between wallets, so a farmer is paid per sale instead of at the end of the week.
- A receipt that cannot be faked: the payment preimage hashes to the invoice. Our proof page checks it for every payout.
- A spending limit enforced by the wallet: the engine gets a Nostr Wallet Connect link with a weekly budget; the wallet answers QUOTA_EXCEEDED when it is used up. Our security claim rests on the wallet, not on our code. We show this live: a 3,000-sat sale in which the co-op and one farmer are paid and the next two payouts are refused.
- A public, tamper-evident record: hash-chained entries signed with a Nostr key and published to public relays.
Remove any one of these and Mandate becomes a spreadsheet with a promise.

## How we built it
- Node.js engine (no framework). `rule.mjs` holds the rule schema and the split arithmetic as pure functions, shared with the browser so the proof page does the exact same maths. Largest-remainder rounding, property-tested so the sum of payouts plus what the owner keeps always equals the sale.
- Alby Hub (LDK, signet) as the wallet. Two Nostr Wallet Connect connections: a listener that can make invoices and hear payments but cannot spend, and a payer that can only pay, with a wallet-enforced budget.
- The engine writes its plan to the signed log before it moves any sat, deduplicates sales by payment hash (notifications can replay), and refuses a payee invoice whose amount differs from what the rule computed.
- `nostr-tools` for signing and publishing. `verify.mjs` re-derives everything and runs in Node (tests) and in the browser (proof page).
- The interface is the Nostalgia Computer template remixed in Framer: a retro desktop where every page opens as a window. The Console window embeds the real console (served from the owner's computer), and the Proof window embeds the public proof page. A small Cloudflare Worker serves the desktop and the project's own pages.
- 27 automated tests: rule maths, engine (replay, budget refusal, wrong-amount invoices), parser, verifier and tamper detection.

## Security by design
- AI never decides money. It proposes; a person confirms; deterministic code decides amounts.
- The spending cap is enforced by the wallet, and the listener connection has no permission to spend at all.
- The plan is logged before any payment; payments are idempotent per invoice.
- Frame protection and a Host/Origin check on the local console.
- Everything is publicly verifiable without trusting us.

## What is real and what is a stand-in (honest limits)
- Real: Lightning payments between wallets on a signet Alby Hub, the wallet-enforced budget and its refusals, the Nostr-signed log on public relays, the proof page and its verification.
- Stand-in: signet has no public Lightning-address service, so in the demo the farmers' "addresses" are sub-wallets on the same hub, and a test wallet plays the buyer. Everything uses test sats, not real money.
- Lightning-address payouts (LNURL-pay) are implemented but have not been run on signet.
- Only invoices the engine creates are treated as sales. Other incoming money is ignored on purpose.
- The owner console runs next to the wallet, on the owner's own computer. We did not host it, to keep the wallet connection off the internet. Visitors see the proof page and the demo video.
- We have no real users yet and make no claims about adoption.

## Challenges we ran into
- Making "the AI proposes, code decides" real: the rule parser can fail or misread, so the validator rejects anything over 100% or unknown, and the owner always confirms in plain English.
- Notifications that replay: the first receive test passed on an unrelated payment. We now match the exact invoice hash and dedupe.
- Lightning address support needs a paid Alby plan for sub-wallets, so the demo pays invoices instead.
- Relay flakiness: the proof page updates as each relay answers, and also carries its own copy of the log.

## Accomplishments we are proud of
A rule written in plain words moves real (test) Lightning payments, and a stranger can check every one of them in a browser. The wallet refuses an overspend live on camera.

## What we learned
The valuable part is not the payment, it is the proof. People accept being paid by a rule when they can check the rule, the maths and the receipt themselves.

## What's next
Run the Lightning-address path on mainnet with a real pilot (a co-op or a small trading group); add rule edits with a visible history; a phone-friendly owner view; multi-currency display; hosted option that keeps the wallet connection on the owner's device.

## Built with
Bitcoin, Lightning, Nostr Wallet Connect (NIP-47), Nostr (nostr-tools), Alby Hub, @getalby/sdk, @getalby/lightning-tools, Node.js, Cloudflare Workers, Framer, ElevenLabs (demo voice-over).

## AI disclosure
Built with Claude Code (Anthropic) under the author's direction. The product's own AI is limited to proposing a rule from a sentence; the demo voice-over was generated with ElevenLabs.

## Answers to likely judge questions
- Could this run on another chain? A payout splitter could, but the wallet-enforced budget through Nostr Wallet Connect, the preimage receipts and the Nostr log are Lightning and Nostr features that the product's trust claims depend on.
- Who is it for? Anyone who has to share one incoming payment among several people on a rule: co-ops, small trading groups, collectives.
