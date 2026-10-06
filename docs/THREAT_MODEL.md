# Threat model

**Scope:** the contracts in `contracts/src`, the operator services in `services/`, and the trust placed in external feeds and issuers.

**What we protect:**
- user funds held in the ledger;
- fair execution: one price per batch, no latency edge;
- liveness, meaning orders always eventually clear;
- the integrity of the reference price;
- regulatory controls.

## Actors and trust

| Actor | Trusted for | Not trusted for |
|---|---|---|
| Admin (multisig + timelock in production) | Upgrades, market parameters, roles | Nothing else: it cannot move user funds except through an upgrade, which is timelocked |
| Guardian | Pausing, halting markets | Prices, funds |
| Reference relays (bonded, k-of-n; testnet) | Publishing the price after each batch closes | Correctness: bounded by the band, audited by CRE, and slashable |
| Chainlink feeds (mainnet) | The price and the time they observed it: each auction prices at the first observation made after its orders were sealed, read by the observation time inside the report the oracles signed ([SPEC §7.4](SPEC.md)) | Speed: an auction waits for the next observation, typically 34 s on MON/USD and 1.5 min on wNVDAx-USD in US market hours ([measured](evidence/causal.md)) |
| Keepers | Nothing: `clear` is permissionless | Choosing the price, the batch or the moment: on a causal market the contract proves the observation is the first after the oldest waiting order and derives the batch from it. On the testnet's operator markets signatures are bound to the batch. |
| Relayer (gasless) | Submitting signed orders | Altering, forging or replaying orders (EIP-712 + nonces + deadlines). It can delay them, but only until the deadline, and users can always submit directly. |
| Attester (KYC) | Recording KYC outcomes | Funds |
| Token issuers (e.g. Anchored) | Their token and their denylist | — |

## Threats and mitigations

| # | Threat | Mitigation | Where |
|---|---|---|---|
| T1 | **Insolvency through rounding.** Lazy pro-rata shares drift from real quantities. | Survival rounds up, so lazy remainders ≥ real quantity. Removals are clamped to the real quantity. Receipts are drawn only from exact pots. Payments round up. Buy locks provably cover quote and fee. | `BookStore`, `UnisonExchange._settle`; invariant suite + 3,000-step simulation + book fuzz on both sides + differential fuzz vs `@unison/engine` |
| T2 | **Bricking the clear with spam:** thousands of levels or groups make it exceed the gas limit. | Resumable job: every phase pauses below 300k gas and resumes. Chunked execution produces byte-identical results to a single call. | `ExchangeClearing`; `ClearJobTest` (300 outside levels, chunked == single shot) |
| T3 | **Cancels mid-apply** shrink a level the auction is about to fill. | Cancels of merged orders revert while a job applies fills. Batches inside a job are frozen. | `cancelOrder` → `ClearInProgress` |
| T4 | **Keeper picks a favourable price** among several valid references, or a favourable grouping or moment. | Causal markets: the price is the first Chainlink observation after the oldest waiting order (`startedAt(r) > T ≥ startedAt(r − 1)`), the batch is every order sealed before it and nothing after, and oracle time never runs backwards, so a keeper delivers and chooses nothing. Operator markets (testnet): each signature is bound to `(venue, market, batch)`, the reference must be published after the batch closed, and publish time is monotonic. | `ChainlinkCausalReference`, `ExchangeClearing._causalReference`, `OperatorSignedReference` |
| T5 | **Compromised relay key** publishes a false price. | k-of-n quorum over independent keys (secp256k1 / P-256 HSMs); signers are bonded and slashable by the CRE audit. Trades can only print inside the band (LIVE ±1%, DISCOVERY capped at the p99 weekend gap). The guardian or CRE can halt the market. | `OperatorSignedReference`, regime bands, `HALT_ROLE` |
| T6 | **Stale-quote sniping** (latency arbitrage). | One uniform price per auction, against a reference observed after the auction sealed: a faster trader knows nothing that price doesn't. Under the old rule (the clear's own time) MON/USD left a gap wider than the WMON vault's spread plus fee 5.3 times an hour ([measured](evidence/causal.md)); the old-rule control market keeps that rule live so the difference stays measurable. | `ChainlinkCausalReference`, `Clearing`, `LiquidityVault`; [fairness evidence](evidence/fairness.md) |
| T7 | **LPs front-run a known gap** (withdraw before Monday's open). | Vault flows execute only at a reference published after the request. A swing fee applies while the market is closed. Inventory and per-auction caps bound exposure. | `LiquidityVault.process` |
| T8 | **Rogue curve source** reverts or burns gas inside the clear. | Sources are operator-listed only; calls are gas-capped (150k) inside try/catch; curves are capped by the source's own ledger inventory. | `_loadCurves` |
| T9 | **Replay or tampering of signed orders**, session-key abuse, passkey forgery. | Unordered nonces, deadlines, full-struct EIP-712. Session keys cannot withdraw and are capped by market, size, notional and expiry. Passkey accounts are derived from the public key; WebAuthn type, challenge, user-presence/user-verification flags and low-s are all checked. | `OrderGateway`, `WebAuthn`; `OrderGatewayTest` |
| T10 | **Reentrancy** through tokens. | Transient reentrancy guard on every state-changing external; SafeERC20; balance-delta deposits (fee-on-transfer safe). | `UnisonExchange` |
| T11 | **Pending ring aliasing and exhaustion.** Until v2 the ring was addressed by block number modulo 256 and a slot was reused even while its batch waited: two waiting batches exactly 256 blocks apart overwrote each other, and the older one's orders could never settle. Per-block clearing hid it. | A slot is never reused while its batch waits, and the ring spans 65,536 blocks (about 7 h). Filling it takes orders in 65,536 distinct blocks within one auction's wait; new orders are then refused (`PendingFull`) until the next clear, and none is ever lost. | `UnisonExchange._addPending`; `PendingRing.t.sol` fails on the old code |
| T12 | **Group capacity griefing**, filling a block's 1,016 groups to exclude others. | Each group needs a distinct `(side, shard, ioc, tick)` order at about 170k gas, so filling capacity takes more than 170M gas, which exceeds Monad's 150M block gas limit. | `GROUP_PAGES` |
| T13 | **Restricted assets reach ineligible or sanctioned accounts.** | `EligibilityRouter` checks KYC attestations (jurisdiction, class, expiry) AND issuer denylists (mirrored from the token's own compliance contract) on deposits, withdrawals and permissioned order entry. Daily ADV caps and tier limits are enforced on-chain. | `compliance/`, `ComplianceTest`, `MonadForkTest` |
| T14 | **Oracle outage or stale feed.** | A causal market waits for an observation after its orders; if the feed stays silent past its heartbeat (or the session closes), it runs DISCOVERY call auctions with bounded bands, anchored at the last observation and recorded with that observation's true time, and its vault stops quoting. HALTED skips the auction entirely. | `ChainlinkCausalReference`, regimes |
| T15 | **Leader censorship** of orders in a block, and **order visibility** while an order waits for its auction. | An order that misses a block is sealed into the next one. A waiting order is public, but with one price per auction and sealed cancels, seeing it buys no better price; it is still order-flow information. A commit–reveal seal is designed, not built, as is BTX encrypted-mempool compatibility. | Roadmap |
| T16 | **Cancel after the price is known:** an observation is in flight for about 13 s before it lands, so a trader who could cancel would keep only the orders the coming price favours, against the vault. | On causal markets every order is an auction order and a waiting order is sealed (`Sealed`). A market switches only with an empty book, so no resting order from the old rule survives into the new one. | `_placeOrder`, `_cancelOrder`, `setCausal` |
| T17 | **Clock skew** between Chainlink's nodes and Monad's validators lets an order placed just after an observation count as before it. | An order must precede the observation by more than `skewSec` (2 s). The observation-to-chain delay was 12–17 s on every round measured, so neither clock runs far ahead of the other. | `Causal.skewSec` |
| T18 | **The quote asset loses its peg** (AUSD), mispricing every market quoted in it. | The AUSD/USD round in force at the observation must be fresh; more than 50 bp off $1 halts the market. | `ChainlinkCausalReference.depegBps` |

## Known limitations (stated)

- **Equity reference data.** On the testnet: the IEX feed or a labelled simulation. On the mainnet beta: Chainlink's tokenized-equity feed wNVDAx-USD, which is Backed's xStock price "Calculated" with a share multiplier of about 1, in Chainlink's risk tier "new", and not Anchored's own price. At scale: a licensed consolidated feed (Pyth Pro / Chainlink Data Streams).
- **Mainnet beta exposure** is capped by small vaults (about $40 at launch) and daily caps (1 aNVDA, 20,000 WMON a day). The admin roles stay with the deployer key until they move behind a public timelock (48 h, rising to 7 days; `contracts/script/HandoverTimelock.s.sol`). A guardian key can pause and halt.
- **Passkeys and domains.** Passkeys belong to `www.unisonfi.com`, and the vercel.app alias reaches them as a related origin (Chrome, Edge, Safari). A browser without Related Origin Requests makes the passkey for its own host. On-chain verification doesn't depend on the domain.
- **Relay measurement lag (testnet).** A relay that lags the true price by δ leaks an edge of order σ·√δ. That's negligible in normal conditions, but larger during news; bands cap it.
- **The causal clock is as fast as Chainlink.** An order waits for the next observation: 34 s typically on WMON, 1.5 min on aNVDA in US market hours and about 15 min overnight. The ticket says so before you trade.
- **Vault-only clears** (no orders waiting) use the latest observation when someone clears; anyone can trigger one right after a request, and the keeper does.
- **A pause holds sealed orders.** While the guardian has the exchange paused no auction runs, and a causal market's waiting orders can't be cancelled (that would hand back the option T16 closes), so their funds stay in the order until it resumes. Free balances can still be withdrawn. A pause delays these funds; it can't move them. A halt is different: the auction that would have priced them trades nothing and returns every waiting order unfilled.
- **Not yet externally audited.** Slither, Halmos on `Clearing`, and an independent review are on the roadmap. The solvency arguments are in SPEC §3.3 and are exercised by the test suites above.
