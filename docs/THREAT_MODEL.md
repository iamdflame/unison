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
| Reference relays (bonded, k-of-n) | Publishing the price after each batch closes | Correctness: bounded by the band, audited by CRE, and slashable |
| Keepers | Nothing: `clear` is permissionless | Choosing prices (signatures are bound to the batch) or ordering (batches are order-independent) |
| Relayer (gasless) | Submitting signed orders | Altering, forging or replaying orders (EIP-712 + nonces + deadlines). It can delay them, but only until the deadline, and users can always submit directly. |
| Attester (KYC) | Recording KYC outcomes | Funds |
| Token issuers (e.g. Anchored) | Their token and their denylist | — |

## Threats and mitigations

| # | Threat | Mitigation | Where |
|---|---|---|---|
| T1 | **Insolvency through rounding.** Lazy pro-rata shares drift from real quantities. | Survival rounds up, so lazy remainders ≥ real quantity. Removals are clamped to the real quantity. Receipts are drawn only from exact pots. Payments round up. Buy locks provably cover quote and fee. | `BookStore`, `UnisonExchange._settle`; invariant suite + 3,000-step simulation + book fuzz on both sides + differential fuzz vs `@unison/engine` |
| T2 | **Bricking the clear with spam:** thousands of levels or groups make it exceed the gas limit. | Resumable job: every phase pauses below 300k gas and resumes. Chunked execution produces byte-identical results to a single call. | `ExchangeClearing`; `ClearJobTest` (300 outside levels, chunked == single shot) |
| T3 | **Cancels mid-apply** shrink a level the auction is about to fill. | Cancels of merged orders revert while a job applies fills. Batches inside a job are frozen. | `cancelOrder` → `ClearInProgress` |
| T4 | **Keeper picks a favourable price** among several valid references. | Each signature is bound to `(venue, market, batch)`. `clearUpTo` binds the exact batch. The reference must be published after the batch closed. Publish time is monotonic per market. | `OperatorSignedReference`, `ExchangeClearing._openJob` |
| T5 | **Compromised relay key** publishes a false price. | k-of-n quorum over independent keys (secp256k1 / P-256 HSMs); signers are bonded and slashable by the CRE audit. Trades can only print inside the band (LIVE ±1%, DISCOVERY capped at the p99 weekend gap). The guardian or CRE can halt the market. | `OperatorSignedReference`, regime bands, `HALT_ROLE` |
| T6 | **Stale-quote sniping** (latency arbitrage). | One uniform price per block against a post-close reference. The vault re-centres on that reference every auction. | `Clearing`, `LiquidityVault`; [fairness evidence](evidence/fairness.md): sniper $0 |
| T7 | **LPs front-run a known gap** (withdraw before Monday's open). | Vault flows execute only at a reference published after the request. A swing fee applies while the market is closed. Inventory and per-auction caps bound exposure. | `LiquidityVault.process` |
| T8 | **Rogue curve source** reverts or burns gas inside the clear. | Sources are operator-listed only; calls are gas-capped (150k) inside try/catch; curves are capped by the source's own ledger inventory. | `_loadCurves` |
| T9 | **Replay or tampering of signed orders**, session-key abuse, passkey forgery. | Unordered nonces, deadlines, full-struct EIP-712. Session keys cannot withdraw and are capped by market, size, notional and expiry. Passkey accounts are derived from the public key; WebAuthn type, challenge, user-presence/user-verification flags and low-s are all checked. | `OrderGateway`, `WebAuthn`; `OrderGatewayTest` |
| T10 | **Reentrancy** through tokens. | Transient reentrancy guard on every state-changing external; SafeERC20; balance-delta deposits (fee-on-transfer safe). | `UnisonExchange` |
| T11 | **Pending ring exhaustion:** the ring fills if no one clears for 256 batches. | `clear` is permissionless and the keeper is incentivised. Users can clear themselves. | `PendingFull` |
| T12 | **Group capacity griefing**, filling a block's 1,016 groups to exclude others. | Each group needs a distinct `(side, shard, ioc, tick)` order at about 170k gas, so filling capacity takes more than 170M gas, which exceeds Monad's 150M block gas limit. | `GROUP_PAGES` |
| T13 | **Restricted assets reach ineligible or sanctioned accounts.** | `EligibilityRouter` checks KYC attestations (jurisdiction, class, expiry) AND issuer denylists (mirrored from the token's own compliance contract) on deposits, withdrawals and permissioned order entry. Daily ADV caps and tier limits are enforced on-chain. | `compliance/`, `ComplianceTest`, `MonadForkTest` |
| T14 | **Oracle outage or stale feed.** | Adapters report CLOSED, so the market enters DISCOVERY call auctions with bounded bands. HALTED skips the auction entirely. The Pyth publish time must postdate the batch. | References, regimes |
| T15 | **Leader censorship** of orders in a block. | Orders that miss a batch join the next one 300 ms later. Sealed commit-reveal orders are planned, as is BTX encrypted-mempool compatibility. | Roadmap |

## Known limitations (stated)

- **Equity reference data** in development comes from the IEX feed or a labelled simulation. Production requires a licensed consolidated feed (Pyth Pro / Chainlink Data Streams).
- **Relay measurement lag.** A relay that lags the true price by δ leaks an edge of order σ·√δ. That's negligible in normal conditions, but larger during news; bands cap it.
- **Not yet externally audited.** Slither, Halmos on `Clearing`, and an independent review are on the roadmap. The solvency arguments are in SPEC §3.3 and are exercised by the test suites above.
