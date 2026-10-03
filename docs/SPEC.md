# Unison Protocol Specification — v0.1 (core engine)

> Status: normative draft for P1–P2. The Solidity contracts, the TypeScript reference clearing (`packages/clearing-ref`), the SDK, and the indexer MUST agree with this document. When code and spec disagree, the code has a bug or the spec gets amended. Never silently diverge.

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

Each market has two sides (BID, ASK). Each side is split into `S` **shards** (default 4), with shard = `uint160(account) % S`. Shards make orders from different accounts in the same block touch disjoint storage pages, which keeps Monad's optimistic parallel execution conflict-free on the order path.

Each `(market, side, shard)` holds:

| Structure | Contents |
|---|---|
| **Levels** `level[tick]` | `remaining` (uint128), `epoch` (uint32), `survival` S (uint128, scale `1e36`), `acc` A (uint128, scale `1e18 × price`) |
| **Epoch finals** `final[tick][epoch]` | A at the moment the epoch closed |
| **Hierarchy totals** | `bucket[tick >> 7]`, `super[tick >> 14]`, side `total` (uint128 sums of `remaining`); used for O(1)-page prefix queries |
| **Non-empty bitmaps** | Per bucket (128 bits); lets clearing skip empty ticks |

All arrays are **page-aligned** (128 consecutive slots = one MIP-8 page). A whole bucket of ticks sits in one page.

### 3.1 Lazy pro-rata accounting

Resting orders at a level share fills **pro-rata**, with lazy accounting:

- **Partial fill**, ratio `r` (fraction of the level's remaining filled, scale `1e18`) at price `p`:
  - `A += S × r × p / 1e36`
  - `S = S × (1e18 − r) / 1e18`
  - `remaining -= filledAgg`
- **Full fill** (`r = 1e18`) at price `p`:
  - `A += S × p / 1e18`
  - store `final[epoch] = A`
  - `epoch++`, `S = 1e36`, `A = 0`, `remaining = 0`
- **Precision guard:** if `S < 1e12` after a partial fill, the level is force-closed as a full fill. The protocol dust reserve is the counterparty for the residual dust.

An order stores `(qty, tick, epochE, SE, AE)` at entry (or at its last claim):

| Case | `fairFilled` | `fairQuote` |
|---|---|---|
| `epochE == epochNow` | `qty × (SE − Snow) / SE` | `qty × (Anow − AE) / SE` |
| `epochE < epochNow` | `qty` | `qty × (final[epochE] − AE) / SE` |

### 3.2 Rounding rule (solvency)

**User receipts round DOWN; user payments round UP.** The protocol keeps the difference in a dust reserve.

- **Buyer:** receives `floor(fairFilled)` base; pays `ceil(fairQuote)` quote. It stays within the order's locked quote because clearing price ≤ limit.
- **Seller:** delivers `ceil(fairFilled)` base, capped at the order's locked base; receives `floor(fairQuote)` quote.
- **Invariant SOLV:** for each token, `token.balanceOf(exchange) ≥ Σ freeBalances + Σ lockedEscrow(outstanding) + Σ curveInventories`, after every external call.

## 4. Liquidity sources merged at clearing

1. **Book levels.** Absolute limit ticks.
2. **Pegged levels.** Offsets in ticks relative to the clearing reference tick, `ref`.
   - Bids sit at `ref − k`; asks at `ref + k`, for `k ∈ [1, L]`.
   - Each level uses the same lazy accounting as §3.1, keyed by offset.
3. **Curve liquidity.**
   - Sources: the `LiquidityVault` and each Designated Maker.
   - **Shape:** quantity per tick is `depthPerTick` for ticks in `[ref + spread, ref + spread + width)` (asks) and the mirror below `ref` (bids). The spread is skewed by inventory.
   - **Capped** by available inventory and the per-batch loss cap.
   - **Settled immediately** at clearing, at the clearing price, against the curve owner's ledger account.

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
1. Walk the side's levels in priority order.
2. Every level fully covered by `V` is fully filled.
3. The first level not fully covered is the **marginal level**. It gets the rest of `V`, applied as ratio `r = (V − before) / levelQty` (scale `1e18`, floor).
4. All later levels get nothing.

All fills execute at `price(t*)`.

## 6. Regimes

| Regime | Trigger | Clearing |
|---|---|---|
| LIVE | Reference status OPEN and fresh | Every block. Band = `ref ± bandLive`. |
| EXTENDED | Status EXTENDED (pre/post market) | Every block. Band = `ref ± bandExt`. Curve caps ×0.5. |
| DISCOVERY | Status CLOSED, or reference stale beyond `staleAfter` | Call auctions every `N` blocks. Center = last discovery print (initially last ref). Half-width = `min(p99 × sqrt(t / Tclosed), cap)`. Curve caps ×0.25. |
| REOPENING | First fresh OPEN reference after DISCOVERY | Collection window of `W` blocks, with indicative price and imbalance published each block. Then a single clear within `ref ± bandReopen`. Then LIVE. |
| HALTED | Mirrored primary halt, CRE deviation, LULD pause, or guardian | No clearing. Cancels allowed. |

**LULD:**
- `luldRef` updates every 200 blocks (~1 min).
- A print outside `luldRef × (1 ± luldPct)` enters LIMIT for 50 blocks (~15 s). Only prices inside the band can execute during LIMIT.
- If the limit state is unresolved, HALTED for 1,000 blocks (~5 min).

## 7. Reference prices

- `IReferenceAdapter.read(marketId, batchTs, payload) → (price, publishTimeMs, status)`.
- **Published-after-close rule:** a batch with block timestamp `bt` seconds only accepts references with `publishTimeMs ≥ bt × 1000`.
- **Adapters:**
  - **OperatorSigned:** a bonded signer; P256 or secp256k1; monotonic sequence.
  - **Chainlink** push feeds.
  - **Pyth** push/pull.
  - **DataStreams:** the licensed path.
  - **CREAudit:** consensus reports. If `|operator − cre| > maxDevBps`, the market goes HALTED and the operator bond is slashable.

## 8. Compliance (TSV module; SEC Release 34-106402)

- **Tiers and symbol guard:** a market's tier follows its LULD tier. Max symbols: 75 for Tier 1, 250 for Tier 2.
- **Daily volume cap:** `capNotional[day] = capBps × ADV`, written daily by CRE. Clearing truncates `V` so the cumulative day notional never exceeds the cap. When the cap is reached, the market goes HALTED for the rest of the day.
- **Eligibility:** for markets flagged `permissioned`, the account must hold a valid eligibility record (attested after Cleanverse A-Pass verification). It is checked at deposit of the asset, at order placement, and at withdrawal.
- **Books and records:** per-batch receipt hash `R_b = keccak(R_{b−1}, batchId, t*, V, refPx, regime, bt)`, plus events. The indexer builds the full machine-readable tape.

## 9. Storage-layout conventions

- **Namespaced (ERC-7201)** root struct for configuration.
- **Page base** for a key: `pageBase(ns, key) = uint256(keccak256(abi.encode(ns, key))) & ~uint256(127)`.
- **Per-account page** (`ns = ACCOUNT`):

  | Slots | Contents |
  |---|---|
  | 0–15 | Balances, one per token index |
  | 16 | Eligibility cache |
  | 17 | Order bitmap |
  | 18–127 | Orders, 2 slots each (55 orders) |

  Overflow pages use `key = (account, pageNo)`.
- **Book arrays:** `pageBase(BOOK, (market, side, shard, bucket))`. A bucket's 128 ticks sit in one page.

## 10. Events (tape)

| Event | Fields |
|---|---|
| `OrderPlaced` | market, account, orderRef, side, tick, qty, flags |
| `OrderCancelled` | orderRef, remainingQty |
| `BatchCleared` | market, batchId, tick, price, volume, refPrice, regime, bandLo, bandHi, receiptHash |
| `Claimed` | orderRef, filledBase, quoteAmt, fee |
| `CurveFilled` | market, batchId, curveOwner, side, qty, price |
| `RegimeChanged` | market, from, to, reason |
