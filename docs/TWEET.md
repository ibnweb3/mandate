Imagine you just sold a hundred jars of shea butter.

The money lands in one lump. Twelve farmers are waiting outside, each asking the same quiet question: how much of it is mine?

Today the honest answer is a notebook, a calculator, and a lot of trust.

So for the Dakar Bitcoin Hack I built Mandate.

You write the payout rule once, in plain words:
"10% to the co-op. Split the rest between Amadou, Fatou and Ousmane by kg delivered."

The moment a sale arrives, everyone is paid their share in seconds over Bitcoin Lightning. Nothing to argue about.

How it stays honest:
- AI only reads the sentence and proposes a rule. You confirm it in plain English. After that it never touches money.
- Plain code does the arithmetic. Not a sat lost or invented.
- The wallet enforces a spending budget through Nostr Wallet Connect. In the demo, a 3,000 sat sale goes out: the co-op and one farmer are paid, then the wallet itself refuses the next payouts because the budget is used up. Even a bug in my code can't overspend.
- Every step is signed and published on Nostr. A proof page, no wallet and no login, re-checks every signature, the split maths and every Lightning receipt in your own browser. There is a "try to cheat" button that shows the check fail.

Why Bitcoin and not "just any chain"? Mandate needs four things at once: instant tiny payments, a receipt nobody can fake, a limit the wallet enforces itself, and a public record. Take any one away and it's a spreadsheet with a promise.

Same engine runs a trader repaying a supplier: "20% of every sale until 500,000 sats are repaid."

Honest limits: it runs on the signet test network with test sats. The farmers' "addresses" in the demo are test wallets on the same hub; Lightning-address payouts are built but not yet run. The console runs on the owner's computer, so you get the video and the proof page. I have no real users yet.

It lives in a retro desktop where every page opens like a file.

Demo (3 min): [paste video]
Try the proof page: https://mandate-proof.ibnweb3lab.workers.dev/
Code (open source): https://github.com/ibnweb3/mandate

Built with Claude Code. Feedback from anyone who shares money by rule, co-ops especially, is very welcome.

#DakarBitcoinHack #Bitcoin #Lightning #Nostr
