# What Halmos proves about the clearing (10 October 2026)

`Clearing.compute` picks each auction's price and volume and how the marginal level on each side is shared. Fuzz and differential tests sample it. [Halmos](https://github.com/a16z/halmos) checks it **for every input** of a fixed shape, by symbolic execution: every path through the code, with the quantities left as unknowns a solver reasons about.

## The properties ([`ClearingHalmos.t.sol`](../../contracts/test/halmos/ClearingHalmos.t.sol))

1. **Prices inside the band, never overfills, respects the cap.** If nothing trades, nothing crosses at any tick of the band. A trade prices inside the band, never fills more than either side offers at that price, and never exceeds the volume cap.
2. **A maximum-volume price.** No tick in the band would trade more, and without a cap the auction executes exactly what crosses there.
3. **Marginal fills are exact.** On each side, the marginal level fills exactly what the volume still needs, and never more than it holds.

Each runs on two shapes of input:
- **2 ticks**, with any `uint64` quantity at every level: both band ticks, the bids above the band, the asks below it, and the cap.
- **3 ticks**, reference in the middle, with quantities below 2^16. With the reference in the middle, the distance tie-break and the equal-on-every-key case are both reachable. The algorithm only adds and compares quantities, so the smaller domain removes no branch; it only bounds the solver's work.

## Results

From the [proofs workflow](../../.github/workflows/proofs.yml): one runner per property and solver, with an hour each, on the Phase A code.

| Property | 2 ticks, any `uint64` | 3 ticks, below 2^16 |
|---|---|---|
| 1. Inside the band, no overfill, cap | **Proven**: 16,358–19,583 paths, under 7 min | Not finished in 60 min |
| 2. Maximum-volume price | **Proven**: about 4,800 paths, under 3 min | **Proven**: 19,329 paths, 5 min |
| 3. Marginal fills exact | Not proven: some solver queries ran out of time (300 s each); **no counterexample** | **Proven** under both solvers: 65,420 paths in 24 min, 107,404 in 39 min |

"Proven" means Halmos explored every path and found the property true on all of them. "Not proven" here never means a counterexample: none was found, but some queries were left undecided.

Two solvers were used: Bitwuzla, and its variant that abstracts nonlinear arithmetic. The variant is the one that handles the fill ratio's division (`need · 10¹⁸ / level`) fastest.

## How it runs

- **Every push:** CI runs the three 2-ticks properties in parallel, 15 minutes each ("Symbolic proof, …"). They report without blocking.
- **Nightly on `main`, and on demand on any branch:** the proofs workflow runs all six under both solvers, an hour each, and keeps every output as an artifact.

Reproduce one property locally (Linux or macOS, from `contracts/`):

```bash
HALMOS_ALLOW_DOWNLOAD=1 bash test/halmos/prove.sh check_band3_marginalFillsAreExact 3600 bitwuzla-abs
```

## What this does not cover

- **Wider bands and larger quantities**, beyond these shapes. The fuzz tests and the [differential tests](../../contracts/test/diff) against the TypeScript engine sample those.
- **Settlement** (`BookStore`, `OrderMath`): how each order's fill and fee are paid out, by apportioning one level among its orders. The invariant suites test it.
- **The rest of the exchange**: the causal rule, jobs and gas yields. The unit, invariant and fork tests cover those, and the [mainnet rehearsals](../GO_LIVE.md#phase-a-exchange-v3-then-the-timelock-roadmap-a) run them against live state.
