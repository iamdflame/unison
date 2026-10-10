# Roadmap: from a fair auction to a venue you can trust with money

On 8 October 2026 an outside review listed 39 problems with Unison as it runs today, and the facts that would make it a category of its own. We checked every claim against the code and the chain. This page is the result: what is true, what the review missed, and the order we are fixing things in. Dates are targets; the boxes say what is done.

## Where Unison stands (9 October 2026)

- **The rule works on mainnet.** Since 6 October each auction prices at Chainlink's first observation after its orders are sealed, and the contract proves it is the first ([causal evidence](evidence/causal.md)). Every receipt can be checked from the chain alone, and the receipt page now does it in your browser.
- **The challenge paid out, on the old rule.** On 8 October the contract paid our own sniper the old-rule control's pot: 30 fills at +14.35 bp, judged against Chainlink's history. On Unison's causal market the same sniper is at −21.1 bp over 53 fills, and its pot stands ([challenge evidence](evidence/challenge.md)).
- **Nobody else trades yet.** `GET /v1/stats` counts zero outside traders. The vaults hold about $65 of the team's inventory, and daily caps keep it small.
- **One key holds the admin roles,** and today it can do more than upgrade: grant itself the gateway role and move any account's funds, re-point a price feed, or trap sealed orders by deactivating a market. The [threat model](THREAT_MODEL.md#what-the-admin-can-do) lists every power.
- **Not audited.** The tests are extensive (Foundry unit, fuzz and invariant suites, a Solidity-versus-TypeScript differential, mainnet-fork rehearsals), but nobody outside has reviewed the contracts.
- **Slow.** An order waits for Chainlink's next push observation: typically 34 s on MON/USD, 1.5 min on wNVDAx in US market hours, about 15 min overnight.
- **aNVDA hasn't printed under the causal rule yet.** Its first weekend of DISCOVERY call auctions starts on Friday 9 October at 20:00 New York time.
- **The CRE sentinel is a dry run.** It runs in Chainlink's simulator against mainnet reads; it holds no role and halts nothing.

## What the review got right

Almost all of it: no outside users or size; the team as liquidity provider, operator, keeper and adversary at once; aNVDA priced from Chainlink's wNVDAx-USD, which is Backed's xStock price, not Anchored's; no corporate-action handling; no way out of a sealed order; no timelock and no audit; a pause that traps sealed orders; a "closed" vault that is a 255× spread rather than no quote; a ticket that used one word, "reference", for two different clocks; receipts the browser trusted from the tape; a compliance map ahead of what the beta enforces; and a team and partner story that is mostly intention.

## What it got wrong

| Claim | What the code and chain show |
|---|---|
| A stale limit is picked off during the wait | Less so while a curve source quotes: in a uniform-price auction a limit order shares one clearing price, set around the new reference. The pick-off is real when the vault is thin or absent, which is why user-side pegged liquidity matters (B3 below). |
| A halt returns sealed orders | Only at the next auction, and that auction still needs Chainlink's next observation or a closed market. A halt doesn't free them sooner. |
| The pending ring covers about 7 hours | About 5.5 hours at Monad mainnet's ~0.3 s blocks. When full it refuses new orders; it never loses one. |
| 36.8 h is the p99 wait outside US hours | It is the p90. |
| The old-rule control market sits in the trade list | It never did, but it leaked onto the status board and one page that read "WMON and WMON". Both are fixed. |
| The testnet's aSPY and aQQQ are browser simulations | They are real testnet markets with mock tokens. Other names run as a labelled simulation. |
| Data Streams is the way to a fast clock | Right, and closer than either side thought: Chainlink's Data Streams verifier (`VerifierProxy 2.0.0`, `0xEd813D895457907399E41D36Ec0bE103E32148c8`) is live on Monad mainnet, with no on-chain fee. Streams are paid ($150 a month each). Pyth's `parsePriceFeedUpdatesUnique` is the self-serve path. |
| A fair price "within one block" of the seal, a median under 2 s | Not under the review's own rule. Block times are whole seconds and an observation must come more than the 2 s skew after the seal, so the floor is about 2–3 s plus landing. The honest target on a pull feed is a median of 3–5 s, against 34 s to 15 min today. |
| Pin the settlement code so an upgrade can't replace it | The clearing libraries are compiled into the exchange, so pinning means moving settlement into its own immutable contract: a migration, kept for later (F). Until then the protection is a 7-day delay that anyone can exit within: withdrawals can't be paused, and after the next upgrade neither can sealed orders be held. |
| A $100k bounty before anything else | Out of proportion to about $65 at risk, and out of budget. Instead: caps frozen, the funds at risk published, free analysers in CI, SEAL's whitehat Safe Harbor, and caps raised only after a funded review. |

## What it missed

- **The admin can move funds without an upgrade.** `DEFAULT_ADMIN` administers `GATEWAY_ROLE`, and a gateway can call `withdrawFor` on any account. The threat model said the opposite; it now says this.
- **The admin can change prices at once.** The deployer owns the price adapters and can call `setFeed`. The old timelock script left it owner for 48 hours after the handover.
- **More instant powers:** deactivating a market traps its sealed orders; the eligibility settings can freeze withdrawals of aNVDA for everyone; the keeper reward can drain the fee ledger.
- **A malformed curve source can block clearing.** `try/catch` doesn't catch a reply that fails to decode. Only the operator can add sources, but this has to be fixed before anyone else can.
- **Our own receipt checker failed every weekend auction.** It required the observation to come after the seal, which a DISCOVERY call auction never does by design. Fixed on 9 October, before the first one.
- **The checker was weaker than the contract,** judging the first observation from the newest order instead of the oldest, and never checking that nobody sealed in time was left out. Fixed.
- **A vault's queue can be stopped by one frozen recipient** (from our own Slither triage, after the review): a redemption the token refuses reverts the whole queue. Only the team is an LP today; the fix comes before any outside LP.
- **Smaller honesty bugs:** a seed price shown when nothing had traded, rounding a tick off the contract's, "$0.00" for a small order, session keys labelled with the wrong markets on mainnet, the team list depending on one environment variable. All fixed.

## The plan

The review's order is right: safety before speed, speed before listings, listings before marketing. Three changes: the free honesty fixes go first; the safety upgrade runs before the timelock, so it doesn't wait a week behind it; nothing that breaks the hackathon's judging path ships before 27 October.

### A. Stop being dangerous to a depositor

- [x] **Receipts.** Weekend (DISCOVERY) and halted auctions verify; the checker judges the full contract rule; the receipt page re-checks every auction in your browser against Monad's RPC and says when the tape disagrees. (9 Oct)
- [x] **The ticket names its clocks.** The last trade against the reference its own auction used, "Chainlink now" with its age, and the next auction at Chainlink's next observation with the measured typical wait; prices and bands rounded exactly as the contract rounds them. (9 Oct)
- [x] **Disclosures where they matter.** aNVDA's price source on the ticket; Anchored's denylist when you deposit; who holds the keys; "not offered to US persons" called a policy, not an on-chain check. (9 Oct)
- [x] **The house's share in public.** `/v1/stats` says how much of each market the vaults traded, and the team list lives in the deployment file. (9 Oct)
- [x] **The documents say what is true.** The threat model lists every admin power; the 3 October simulation is labelled as one; the compliance map says it is not a licence. (9 Oct)
- [ ] **One exchange upgrade.**
  - Pausing, halting or deactivating a market clears it in a return-only mode that reads no oracle and returns every waiting order.
  - No house curve outside open sessions.
  - The gateway role's admin becomes a role nobody holds.
  - Curve sources are read with a bounds-checked low-level call.
  - A closed market's call auction that the first observation after its orders already bounded clears at once. Under the old code, the call-auction cadence could hold such orders forever when a feed published while the market was closed. Found while designing the pull adapter, whose feeds publish all weekend.
  - Rehearsed by upgrading the live exchange on a mainnet fork first.
- [ ] **A 7-day timelock from the first day,** proposed by a Safe with outside signers, executable by anyone, cancellable by a guardian Safe. Every role and every adapter's ownership moves in one run, with no window in which the deployer still owns an adapter. The signer set will be published here.
- [ ] **Security within our means.**
  - Slither, Aderyn and Halmos in CI. Done (10 Oct): every finding triaged ([static analysis](evidence/static-analysis.md)), and the clearing's properties proven for every input of two shapes ([proofs](evidence/proofs.md)).
  - SEAL's whitehat Safe Harbor.
  - The funds at risk shown live on the status page.
  - Caps frozen until an outside review.

### B. A clock as fast as the chain, and a fair way out

- [ ] **A causal pull adapter.** Built and tested on Chainlink Data Streams (10 Oct; [evidence](evidence/streams.md)).
  - A signed report is verified, stored, then read by the unchanged exchange. Contiguous report windows prove it is the first observation after the seal, so nobody chooses the price.
  - Tested against Chainlink's real verifier on a Monad fork, with reports its DON signed.
  - Monad's verifier is free to use; the stream is not: $150 a month for NVDA's regular hours.
  - Pyth, the plan's first choice, has needed a paid plan since 31 July 2026: $5,000 a month for US equities.
  - It goes live when a stream is funded. Target: a median of 3–5 s from seal to clear.
- [ ] **The sniper benchmark, re-run at the deployment's real latency,** published beside the old one.
- [ ] **A deterministic maximum wait.** An order whose first qualifying observation came more than the wait after its seal is returned, never filled. It is decided by timestamps alone, so nobody gets an option on a price in flight.
- [ ] **Pegged orders for everyone, first as a curve source.** Deposits quote at a fixed offset from the reference, repriced at each observation, with no change to settlement. Built (10 Oct) as `PegPool` ([SPEC §4.2](SPEC.md#42-pegpool-built-not-deployed)):
  - one side and one offset per pool, with no owner;
  - pro-rata shares, read from its ledger balances;
  - asynchronous entry at a live reference;
  - in-kind exit.

  Not deployed: each pool takes one of a market's four curve-source slots, and adding one is an admin action.
- [ ] **Settle from the ticket.** Anyone can land the auction they are waiting on. The contract half exists: `ClearRouter` brings the report and clears in one transaction, and pays the keeper reward to whoever sent it.

### C. List the asset the oracle is about, and open the book

- [ ] **wNVDAx under the existing causal adapter.** Chainlink's wNVDAx-USD already prices it. The token is confirmed on Monad (10 Oct):
  - wNVDAx is [`0xa8ddb5cd96b5222afe198316e9a57caa642850d5`](https://monadscan.com/address/0xa8ddb5cd96b5222afe198316e9a57caa642850d5), Backed's ERC-4626 wrapper over NVDAx (`0xc845b2894dBddd03858fd2D643B4eF725fE0849d`). 1 wNVDAx = 1.0017 NVDAx.
  - About 12,996 NVDAx exist on Monad, but no wNVDAx has been wrapped there yet.
  - Inventory has to come from a partner wrapping NVDAx, not from the team.
- [ ] **A vault whose queue no frozen address can stop.** Built (10 Oct) as `LiquidityVault` v2: a redemption the token refuses is held for its owner and claimed later through the exchange, so it can't stop everyone behind it ([static analysis](evidence/static-analysis.md)). Deployed as new vaults before any outside LP.
- [ ] **Permissionless curve sources with a bond,** a cap on quoted width and an inventory ceiling. The house is labelled and capped.
- [ ] **Partners, in this order, once A and B are done:** xStocks/Backed; one market maker running a vault; Anchored, for an aNVDA feed or an explicit basis market; Agora, for a second quote asset.

### D–F. Later

- **D:** a USDC quote; a weekend DISCOVERY run with the vault empty on purpose and outside accounts; research into a perp whose mark is the causal print.
- **E:** a compliance path, either real enforcement or an operator of record; people who have run a market.
- **F:** settlement in its own immutable contract; formal proofs of the clearing and of the first-observation check; the causal adapter offered to other Monad venues.

### After judging ends (27 October)

- Separate hostnames for the testnet and mainnet.
- Retire the old-rule control's money, keeping its code and fork tests.
- Size the challenge pot like a bounty, or retire it.

## What we won't do

- Buy traders, or count our own accounts as outside demand. The zero on `/v1/stats` stays until it is real.
- List markets without depth.
- Lead with a simulation.
- Add cancels during the wait "for UX". Pegged orders and a deterministic maximum wait are the versions that stay fair.
- Raise caps before the timelock and an outside review.
- Call the CRE sentinel live while the simulator is the evidence.

## Where this ends

Eight facts at once would leave no neighbouring product in the same box:
1. The token and the oracle are the same asset.
2. The fair price is signed seconds after the seal, not minutes, and the contract proves it came after.
3. A user can lose the race and still not be trapped.
4. At least three independent liquidity providers quote, permissionlessly, with inventory the team doesn't own.
5. Outside traders are most of the fills, from a client that checks the chain itself.
6. No key can move funds faster than a week, and an outside report says the clear is sound.
7. The catalogue is what people hold.
8. The same clock prices a perp.
