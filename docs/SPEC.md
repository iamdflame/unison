# Unison Protocol Specification — v0.3

> Status: normative draft for P1–P2. The Solidity contracts, the TypeScript reference clearing (`packages/engine`), the SDK, and the indexer MUST agree with this document. When code and spec disagree, the code has a bug or the spec gets amended. Never silently diverge.

## 1. Model

Unison is a **frequent batch auction (FBA)** venue. Orders rest in **persistent books**. Every batch (default: one Monad block), all crossing liquidity executes at **one uniform price**. Within a batch, arrival order has no effect on price or allocation.

## 2. Units and prices

| Symbol | Meaning |
|---|---|
| `base` | Asset token, e.g. aNVDA with 18 decimals. `B = 10^baseDecimals`. |
| `quote` | Settlement token, AUSD with 6 decimals. |
| `tick` | `uint32` index. **price(tick) = tick × tickSize**, in quote units per `B` base units (one whole base token). |
| `qty` | Base units (`uint96`). |
| `notional(qty, tick)` | `qty × price(tick) / B` quote units. |

Each market fixes `tickSize`, `minTick` and `maxTick`.

Example (aNVDA): `tickSize = 10_000` ($0.01 in AUSD units), so the tick range covers $0.01 to $42,949,672.95.

## 3. Books

Each market has two sides (BID, ASK). Each side has `S` **main books** (default 4, max 8) and `S` **IOC books**. An order goes to shard `uint160(account) % S` (the IOC book of that shard for IOC orders, at book index `8 + shard`). Accounts in different shards touch disjoint storage pages, which keeps Monad's optimistic parallel execution conflict-free on the order path.

Each book `(market, side, shard)` holds:

| Structure | Contents |
|---|---|
| **Level words** (three page-aligned arrays, 128 ticks per page) | `LEVEL` = `remaining` u128, `epoch` u64, `scale` u32, `closed` bit. `STATE` = survival `S` u128, `pot` u128. `ACC` = accumulator `A` u256. |
| **Scale finals** `final[tick][epoch][scale]` | `A` at the end of a scale closed by a rescale |
| **Archives** `archive[tick][epoch]` | The three words of a closed epoch, copied when the tick is reused |
| **Hierarchy totals** | `bucket[tick >> 7]`, `super[tick >> 14]`, book `total`; give O(pages) prefix sums and empty-range skipping |

### 3.1 Lazy pro-rata accounting

A level holds the **real** resting quantity `remaining`, plus lazy state that lets any number of orders share fills pro-rata in O(1).

- **Survival `S`** is a Liquity-style product with precision `S_SCALE = 1e38`. When `S` falls below `S_MIN = 1e29`, it is multiplied by `K = 1e9` and `scale++`. The `A` of the closed scale is stored in `final`.
- **Accumulator `A`** for each `(epoch, scale)` is `Σ S·ρ·p`, where `ρ = f/remaining` and `p` is quote units per whole base token.
- **Partial fill** of exactly `f < remaining`:
  - `A += S·p·f/remaining` (bids round up, asks round down);
  - `S ← ⌈S·(remaining − f)/remaining⌉` (both sides round up), rescaled if needed;
  - `remaining −= f`.
- **Full fill** (`f = remaining`):
  - `A_last = A + S·p` (exact);
  - the level is **closed in place** (`closed = 1`, `S = 0`).
  - When the next order group joins the tick, the closed words are archived and `epoch + 1` opens.

**Order groups.** All orders of one `(batch, side, book, tick)` join the level together at merge. They share one **merge snapshot** `(epoch, scale, S₀, A₀)`. An order record never stores its own snapshot: it keeps its original `qty` and one `credited` counter.

**Valuation** of `qty` that joined with snapshot `(e, s₀, S₀, A₀)`. Let `(S_end, s_end, A_end)` be the level's current state, or the archived state if epoch `e` is closed.

- `remainder = ⌈qty · S_end / (S₀ · K^(s_end − s₀))⌉`, which is 0 when `S_end = 0` (fully filled). It is 1 if more than 4 scales were crossed, since the exact value is then below 1.
- `quote = qty · Σ_j ΔA_j / K^j / (S₀ · baseUnit)`, summed over the scales walked (at most 4), where `ΔA_0 = A(s₀) − A₀` and `ΔA_j = A(s₀ + j)`. Bids round up and add 1 if deeper scales exist, which together are worth less than one unit. Asks round down.

### 3.2 Pots

Lazy math only decides **how** a level's proceeds are shared. **Receipts are always drawn from a pot that holds exactly what was filled.**

- **Bid level pot** (base): `+= f` on every fill. A buyer draws `min(filled − credited, pot)`.
- **Ask level pot** (quote): `+= ⌊f·p/baseUnit⌋` on every fill. A seller draws `min(quote − credited, pot)`. The fee is charged on the cumulative gross amount, `fee(x) = ⌈x·feeBps/1e4⌉`, so the net is monotone.
- **Return pot** (IOC asks only): when an IOC level is force-closed, its unfilled `remaining` becomes the return pot that its sellers draw from.

### 3.3 Conservation argument

1. Rounding `S` up means the lazy remainders of a level's orders always sum to at least `remaining`, written `L ≥ R`.
   - Each fill keeps it: `S' ≥ S·R'/R`, so `L' ≥ L·R'/R ≥ R'`.
   - An add keeps it: both sides grow by `qty`.
   - A removal keeps it: `leave` removes `min(⌈lazy⌉, R)`.
   - **Removals are clamped to `R`.** So the book empties exactly when the last order leaves, and nobody takes out more than exists.
2. **Base, asks.** Sellers' locked base is returned only through clamped removals, or the return pot. So `Σ delivered = Σ fills` exactly once the level empties.
3. **Base, bids.** Buyers' receipts are capped by the base pot, so `Σ received ≤ Σ fills`.
4. **Quote, bids.** Buyers pay `Σ quote ≥ L·f·p/R ≥ f·p`, which is at least what the ask pots receive (`⌊f·p⌋`). A buyer's total spend (`quote + fee`) is provably at most its lock: `buyLock = ⌈notional at limit⌉ + ⌈maxFee⌉ + 4`. The proof uses `qty < 2^96` and `baseUnit ≥ 1e6`, and markets enforce `baseDecimals ∈ [6, 18]`.
5. **Quote, asks.** Sellers' receipts are capped by the quote pot.

**Invariant SOLV:** for each token, `balanceOf(exchange) ≥ Σ free ledger balances` after every call. Once every order is settled, the difference is bounded rounding dust.

The invariant suite enforces SOLV, plus "dust ≤ bound after a full settlement". A 3,000-step simulation checks the same properties, and so does a book-level fuzz on both sides that asserts these exact inequalities.

## 4. Liquidity sources merged at clearing

1. **Book levels.** Absolute limit ticks in the main books (GTC) and the IOC books (§3, §5.6).
2. **Curve sources** (`ICurveSource`: the `LiquidityVault`, Designated Makers). Per auction, each source returns `bidTop, bidTicks, bidPerTick, askBottom, askTicks, askPerTick`. The venue then:
   - calls the source with a 150k gas cap inside try/catch, so a failing source simply quotes nothing;
   - clips the curve to the band;
   - caps it by the source's own ledger inventory. Asks are capped by base balance; bids by quote balance at the worst-case cost of `ceil(ticks·q·price(top)/B)`;
   - merges it into the clearing input;
   - settles it **atomically at the auction price** when the auction starts. Ticks strictly better than the marginal tick fill in full. At the marginal tick, sources are apportioned first, and the books continue the same cumulative apportionment from `bidBefore0` / `askBefore0`.

   Curve sources pay no fee, and receive `onAuction(...)` (gas-capped) for accounting.
3. **Pegged levels** (roadmap). Offsets relative to the reference tick, with the same lazy accounting keyed by offset.

### 4.1 LiquidityVault

The vault's curve:
- half-spread = `spreadBps × {1, extMult, closedMult}[status]`;
- inventory skew = `(w − 50%) · maxSkewTicks / 50%`, where `w` is the base share of NAV;
- depth per tick = `depthBps · NAV`, capped per side at `maxAuctionBps · NAV / width`;
- no quotes while HALTED.

**Flows** are ERC-7540 style:
- `requestDeposit` (quote) and `requestRedeem` (escrowed shares) execute in `process()` only at a venue reference with `publishTimeMs > request time`, and never while a clear job is running;
- deposits mint `assets·(supply + 1e6)/(NAV + 1)` shares;
- redemptions are paid pro-rata in kind;
- a `swingBps` fee applies while the last status is CLOSED or HALTED.

**Attribution:**
- `spreadPnl += (ref − p)·bought + (p − ref)·sold`;
- `inventoryPnl += Δref · inventory`, marked at each auction and each `process()`;
- `NAV change = spreadPnl + inventoryPnl` (tested exactly).

**v2 (not deployed):** a redemption the token or the exchange refuses is held for its owner, outside the vault's ledger balance, and the queue moves on. The owner can `claim` it later through the exchange.

### 4.2 PegPool (built, not deployed)

A pegged order anyone can join. Each pool has one side and one offset, fixed at deployment, and no owner:
- **Its curve** is one level. A bid pool holds quote and bids at `refTick − ⌈refTick·offsetBps⌉` for all the base its quote buys there. An ask pool holds base and offers all of it at `refTick + ⌈refTick·offsetBps⌉`.
  - It quotes only while the reference market trades (OPEN or EXTENDED).
  - It fills at the auction's uniform price, at or better than its peg, with no fee.
- **Shares** are pro-rata claims on the pool's ledger balances, so a fill changes what every share holds in the same proportion. Nothing depends on `onAuction`, which may be skipped.
- **Flows** are asynchronous, as in the vault:
  - a deposit executes at the first reference after the request, only while the reference market trades, valued at that reference;
  - a redemption is paid pro rata in kind at the first reference after the request, whatever the session;
  - a refused redemption is held for its owner.

## 5. Clearing algorithm (per market, per batch)

**Inputs:**
- Reference price `refPx` (adapter; §7);
- Regime (§6);
- Band `[lo, hi]` in ticks.

**Levels, in priority order:**
- BID levels, descending price: `[ABOVE(hi), hi, hi−1, …, lo]`. `ABOVE` aggregates all bid liquidity with tick > hi.
- ASK levels, ascending price: `[BELOW(lo), lo, …, hi]`.

**Cumulative quantities:**
- `D(t) = bidAbove + Σ_{u ≥ t, u ≤ hi} bid(u)`
- `S(t) = askBelow + Σ_{u ≤ t, u ≥ lo} ask(u)`

**Selection:** `t*` maximizes `E(t) = min(D(t), S(t))`. Ties break by:
1. smallest `|D − S|`;
2. smallest `|t − refTick|`;
3. lowest `t`.

If `E(t*) = 0`, there is no trade.

**Allocation** (both sides, executed volume `V = E(t*)`):
1. Walk the side's classes in priority order: `ABOVE`/`BELOW`, then in-band ticks.
2. Every class fully covered by `V` is fully filled.
3. The first class not fully covered is the **marginal class**. It gets `need = V − before`, spread over the levels of that class (all books, main and IOC) by **exact cumulative apportionment**:
   - `share_i = ⌊need·(Q_<i + q_i)/Q⌋ − ⌊need·Q_<i/Q⌋`;
   - shares sum to exactly `need`, each is at most `q_i`, and each is within one unit of pro-rata.
4. All later classes get nothing.

All fills execute at `price(t*)`. When the job finishes, it checks `Σ bid fills = Σ ask fills = V` and reverts otherwise.

### 5.6 The resumable clear job

`clear()` runs a **job** with four phases. Each phase stops starting new work once `gasleft() < 300k` and continues in the next call, so no number of resting orders can make clearing impossible.

| Phase | Work |
|---|---|
| MERGE | Pending batches up to `upTo = block.number − 1` join the books. GTC orders go to the main books and IOC orders to the IOC books. Each group stores its merge snapshot. |
| auction | Read the reference, which must be published after the newest merged batch closed. Build the band, run `Clearing.compute`, store the result. Skipped while HALTED. |
| APPLY | Cursor over side → stage (`OUTSIDE`, `INBAND`, `MARGINAL`) → book → tick. Fills are applied level by level. |
| CLOSE_IOC | Every IOC level is force-closed. Its unfilled remainder leaves the book. |

**While a job runs:**
- cancels of orders in batches it covers are refused (`ClearInProgress`);
- cancels of any merged order are refused during APPLY and CLOSE_IOC;
- new orders and claims are unaffected.

**Determinism.** A chunked run produces byte-identical balances to a single-call run. This is checked by `ClearJobTest.test_chunkedClearEqualsSingleShot`.

## 6. Regimes

The reference status selects the regime. The band half-width in bps is `_regimeBandBps`.

| Regime | Trigger | Band | Cadence |
|---|---|---|---|
| LIVE | status OPEN | `bandBps` | Every batch |
| EXTENDED | status EXTENDED (pre/post market) | `extBandBps` | Every batch |
| DISCOVERY | status CLOSED (calendar or stale feed) | Around the last close: `max(discFloorBps, discCapBps·√(min(t, H)/H))`, where `t` is the time since the CLOSED period began (`closedSince`, set from the first CLOSED reference) | Call auctions: a job may open only if `upTo ≥ lastDiscoveryBatch + discCadence` (`TooEarly` otherwise). Orders accumulate between auctions. On a causal market whose feed publishes while closed, the first observation after the orders fixes `upTo`; waiting could never move that boundary, so such a job opens at once. |
| REOPENING | First OPEN/EXTENDED auction after CLOSED or HALTED | `reopenBandBps` (the opening cross) | Once, then LIVE |
| HALTED | Status HALTED, or the `HALT_ROLE` override (guardian / CRE) | — | No auction. IOC orders are refunded; GTC orders rest. |

Every auction can print only inside its band (LULD-like price limits per batch).

**Defaults at market creation:** `ext = 2×band`, `reopen = 5×band`, `floor = band`, `cap = 5×band`, `H = 235,800 s` (Fri 16:00 → Mon 09:30 ET), `cadence = 10` blocks. Operators calibrate per asset; for example NVDA's cap is the weekend-gap p99 of 726 bps.

**Roadmap:** the LULD limit state (a five-minute reference with limit and pause stages), and an indicative opening price plus imbalance publication during collection.

## 7. Reference prices

- **Interface.** `IReferenceAdapter.read(marketId, batch, payload) → (price, publishTimeMs, status)`. `batch` is the newest batch the job covers. A job binds its reference once, at open.
- **Published-after-close rule.** With `newestTs` the registration timestamp of the newest pending batch ≤ `upTo`, the reference must satisfy `publishTimeMs ≥ (newestTs + strict) × 1000`.
- **`clearUpTo(marketId, upTo, payload)`** covers exactly the batches ≤ `upTo` (where `upTo < block.number`). A signed reference therefore stays valid whichever later block the keeper's transaction lands in. `clear(marketId, payload)` uses `block.number − 1`.

**Adapters**

| Adapter | Behaviour |
|---|---|
| `OperatorSignedReference` | EIP-712 `Reference(venue, marketId, batch, price, publishTimeMs, status)`. k-of-n quorum over secp256k1 (`ecrecover`) and P-256 (`0x0100` precompile) signers. Freshness window `maxAgeMs`; no more than 2 s in the future; monotonic per market. Only the venue may consume. Bonded signers, a 7-day unbond delay, and `slash` by `SLASHER_ROLE` (the CRE audit). |
| `ChainlinkCausalReference` | The mainnet adapter since 6 October 2026 (§7.4). Chainlink read by the observation time inside the report its oracles signed; each auction prices at the first observation after its orders were sealed, proven from the feed's history. aNVDA through wNVDAx-USD (24/5 session window), WMON through MON/USD, both over AUSD/USD. |
| `StreamsCausalReference` | The same rule on Chainlink Data Streams (§7.4): a signed report is verified by Chainlink's verifier, stored under its observation time, then read by the exchange, and the report whose window holds the second after the seal is the first observation after it. Sessions come from the report's `marketStatus`. Built and tested against the real verifier on a Monad fork; not deployed, because each stream is a paid subscription ([evidence](evidence/streams.md)). |
| `ChainlinkReference` | Base/USD ÷ quote/USD (separate max ages). OPEN inside the weekly UTC session while fresh, otherwise CLOSED. The reference time is the clear time. Mainnet's markets used it from launch until the causal cutover; it now prices only the old-rule control market (market 2), kept so the standing challenge has a baseline. |
| `PythReference` | Pull updates passed as the payload (the fee is paid from the adapter; venue-only). Returns Pyth's publish time, so a stale price fails the after-close rule. A confidence gate sets CLOSED. Built and tested, not deployed: Hermes has required a paid key since 26 August 2026. |
| `ManualReference` | Tests and replays only. |
| CRE audit (`CREAuditReceiver`) | Consensus reports compared with the operator's reference; on a deviation, `setHalt` plus `slash`. The workflow runs in simulation until CRE deploy access is granted. |

### 7.4 Causal markets: the oracle is the clock

A market switched with `setCausal(marketId, adapter, true, skewSec)` prices every auction at the first oracle observation made after its orders were sealed. Only the admin can switch, and only while nothing waits, no job runs and the book is empty, so no order lives under two rules. The adapter is an `ICausalReference`; mainnet's is `ChainlinkCausalReference`. [Evidence and measurements](evidence/causal.md).

- **Observation time.** Chainlink's OCR2 feeds return `startedAt` = the observations timestamp inside the report the oracle quorum signed; `updatedAt` is when the report landed (about 13 s later on Monad). The adapter uses `startedAt` and refuses a round whose `startedAt ≥ updatedAt`, so a chain timestamp can never pass for an observation.
- **The price.** Let `T` = the registration time of the oldest waiting batch + `skewSec` (2 s on mainnet: the margin between Chainlink's clocks and Monad's). The clear's payload names base round `r` and the quote round in force; the adapter requires `startedAt(r) > T ≥ startedAt(r − 1)`. The predecessor check is skipped only on a proxy phase's first round, which happens when Chainlink replaces the aggregator.
- **The batch.** The contract derives `upTo`: the newest waiting batch registered before `startedAt(r) − skewSec`, by binary search over the pending list. A caller's `upTo` is ignored. Nothing sealed before the observation is left out; nothing after it is let in.
- **Auction orders.** `_placeOrder` forces IOC: an order joins one auction and its remainder is returned. A waiting order can't be cancelled (`Sealed`). An observation is in flight for about 13 s before it lands; a cancel in that window would let a trader keep only the orders the coming price favours.
- **Time.** `refTimeMs = startedAt(r) × 1000`, and it never decreases (`StaleReference`).
- **Closed.** With an empty payload and no observation after `T`, the adapter answers only if the session is closed or the feed has been silent longer than `maxAgeSec`; otherwise it reverts `NotYet`. The market then runs a DISCOVERY call auction anchored at the last observation, recorded with that observation's true time. Vaults on causal markets set `closedMult = 255`, so they don't quote while closed.
- **Quote divisor.** The quote round must be the one in force at `startedAt(r)`: observed at or before it, its successor (if any) after it. If it is older than `quoteMaxAgeSec`, or AUSD is off $1 by more than `depegBps` (50), the status is HALTED and no auction trades.
- **Nothing waiting.** A clear with no waiting orders uses the latest observation; it exists to give vault requests a reference made after them.
- **Event.** `CausalReference(marketId, upToBlock, round, sealedAt, observedAt)`, emitted when the job opens.
- **On a pull oracle** (`StreamsCausalReference`, not deployed). The payload names a stored report by its `observationsTimestamp`, plus the quote round. The adapter requires `observationsTimestamp > T` and `validFromTimestamp ≤ T + 1`: the report's window holds the second after `T`. Chainlink's windows are contiguous, so that report is the first observation after `T`, and `round` in the event is its observation time.
  - There is no empty-payload path, because a pull oracle can't prove that no report exists.
  - Closed periods still produce reports, with a closed status. Each one bounds its call auction like any causal observation, so v3 opens it without waiting for the cadence.

## 8. Compliance (TSV conditions; SEC Release 34-106402)

| Control | Rule |
|---|---|
| Tiers and symbol guard | `setTier(market, 1 or 2)`. At most 75 tier-1 and 250 tier-2 symbols (`TierFull`). |
| Daily volume cap | `setDailyCap(market, baseUnits)` (`CAP_ROLE`: the CRE ADV workflow / operator). `Clearing.Input.maxVolume = cap − traded(today UTC)`. `t*` is the uncapped max-volume price; only the executed volume is capped. An exhausted cap means no auction until the next UTC day. |
| Eligibility | `IEligibility` checked at: deposits and withdrawals of `restricted` tokens; order entry on `permissioned` markets; gateway-relayed actions, against the real account. `EligibilityRouter` = AND over sources: `AttestationEligibility` (KYC outcome: jurisdiction, class, expiry, attester ref) and `IssuerDenylistEligibility` (mirrors issuer denylists, e.g. Anchored's `COMPLIANCE()`). |
| Books and records | Per-batch receipt chain `R = keccak(R_prev, market, upTo, t*, V, ref, refTimeMs, status, timestamp)`, plus events. |
| Notices | `postNotice(market, docHash, uri)`. |

## 9. Storage-layout conventions

- **Namespaced (ERC-7201)** root struct `unison.exchange.main` for configuration, markets, jobs, regimes, sources, caps and (appended in v2) each market's causal mode. `Market` is an array element, so it never grows: new per-market state goes in mappings at the end of the root struct.
- **Pending ring.** Waiting batches live in per-market rings addressed by block number modulo `RING` (65,536). A slot is never reused while the batch holding it waits (`PendingFull`); before v2 it was 256 blocks and reused regardless, so two batches waiting exactly 256 blocks apart overwrote each other.
- **Page base** for a key: `pageBase(ns, key…) = keccak256(abi.encode(ns, key…)) & ~127`.
- **Per-account page:** slots 0–15 balances, 16 eligibility cache (reserved), 17 order bitmap, 18–127 orders (two slots each, 55 orders).
- **Order record.** Slot A packs `qty96 | tick24 | market24 | side8 | shard8 | flags8 | state8 | batch48 | feeBps16 | maxFeeBps16`. Slot B is `credited128` (bids: base received; asks: gross quote received). The entry snapshot lives in the group's merge record `keccak(NS_MERGE, market, batch, side, bookShard, tick) & ~1`.
- **Book words.** Three parallel page-aligned arrays per `(market, side, shard)` (`LEVEL`, `STATE`, `ACC`; 128 ticks per page), plus `final[epoch][scale]` and `archive[epoch]`. Hierarchy totals: bucket (128 ticks), super (16,384 ticks), total.

## 10. Events (tape)

| Event | Fields |
|---|---|
| `OrderPlaced` | marketId, account, slot, side, tick, qty, flags, batch |
| `OrderCancelled` | marketId, account, slot, releasedQty |
| `Claimed` | marketId, account, slot, side, baseAmount, quoteAmount, fee, done |
| `BatchCleared` | marketId, upToBlock, tick, price, volume, refPrice, refTimeMs, status, bandLo, bandHi, receiptHash |
| `CurveFilled` | marketId, source, upToBlock, boughtBase, paidQuote, soldBase, receivedQuote |
| `ClearProgress` | marketId, upToBlock, phase, work (a job paused mid-way) |
| `CausalReference` | marketId, upToBlock, round, sealedAt, observedAt (causal markets, §7.4) |
| Configuration | `MarketCreated`, `MarketParamsSet`, `RegimeSet`, `HaltSet`, `SourceSet`, `DailyCapSet`, `TierSet`, `NoticePosted`, `KeeperPaid` |

## 11. Order gateway

`OrderGateway` relays EIP-712 `Order`, `Cancel`, `Withdraw` and `Session` messages to the venue's `*For` entrypoints (`GATEWAY_ROLE`).

**Signatures** are `abi.encode(kind, data)`:

| Kind | Signer | Allowed actions |
|---|---|---|
| `0` | The account: ECDSA or ERC-1271 | Everything |
| `1` | Session key granted by the account | Place and cancel only. Caps: market mask, `maxQty`, `maxNotional` (`qty·tick·tickSize/baseUnit`), expiry. Never withdraw. |
| `2` | WebAuthn assertion from the account's P-256 passkey | Everything. The account address is `address(keccak("unison.passkey", qx, qy))`. Checks: `type = webauthn.get`; challenge = base64url(digest); UP and UV flags; low-s; P-256 over `sha256(authData ‖ sha256(clientDataJSON))`. |

**Replay protection:** unordered nonces (a 256-bit bitmap per word) and deadlines. `placeBatch` skips failing orders and emits `RelayFailed(index)`.
