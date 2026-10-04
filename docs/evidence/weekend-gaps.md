# Weekend gaps: how far stocks open from Friday's close (2026-10-04)

**Script:** `research/weekend-gaps/gaps.mjs` (rerun any time; it rewrites this file and `weekend-gaps.json`).

**Data:** five years of daily bars from Yahoo Finance's public chart API (split-adjusted). A "weekend" is any break of 2.5 days or more between trading days, so long weekends count too. Weekends that span a stock split are skipped. The gap is |first open after the break ÷ last close before it − 1|.

| Symbol | Window | Weekends | Opened >2% away | Mean gap | p99 gap | Max gap |
|---|---|---:|---:|---:|---:|---:|
| NVDA | 2021-10-04 → 2026-10-02 | 259 | 24% | 1.4% | 7.3% | 14.2% |
| TSLA | 2021-10-04 → 2026-10-02 | 260 | 34% | 1.9% | 8% | 12% |
| COIN | 2021-10-04 → 2026-10-02 | 260 | 46% | 2.4% | 9.8% | 21.3% |
| MSTR | 2021-10-04 → 2026-10-02 | 260 | 53% | 2.9% | 14.8% | 27.4% |
| SPY | 2021-10-04 → 2026-10-02 | 260 | 2% | 0.5% | 2.6% | 4% |
| QQQ | 2021-10-04 → 2026-10-02 | 260 | 3% | 0.6% | 3.3% | 5.4% |
| AAPL | 2021-10-04 → 2026-10-02 | 260 | 6% | 0.8% | 5.9% | 9.4% |
| GLD | 2021-10-04 → 2026-10-02 | 260 | 6% | 0.7% | 3.1% | 3.7% |

## What it means for Unison

- Holders of these stocks carry this risk every weekend with no way to act on news until Monday's open.
- Unison's DISCOVERY regime runs call auctions while the primary market is closed. Its price band widens with the square root of the time since the close, so its cap tracks a p99-style weekend move (`discCapBps` in `deploy/monad-mainnet.json`).
- These are historical gaps, not forecasts.
