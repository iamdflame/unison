# Unison Protocol Specification — v0.2 (core engine)

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
