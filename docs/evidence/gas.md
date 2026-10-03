# Gas evidence — Monad vs Ethereum rules (2026-10-03)

Measured by `contracts/test/gas/GasBench.t.sol`, identical code on two EVMs:

- **Ethereum rules:** `forge test --match-contract GasBench -vv`
- **Monad rules:** `forge test --fork-url <Monad mainnet fork> --match-contract GasBench -vv`. Foundry 1.8.4 executes forks of chain 143 on its Monad EVM, which applies MIP-8 page-based storage pricing.

| Operation | Ethereum gas | Monad gas | Note |
|---|---:|---:|---|
| deposit (first token, cold account page) | 100,710 | 160,917 | Includes the ERC-20 `transferFrom` |
| placeOrder (first of block: new batch + group) | 215,808 | 236,137 | Registers the batch in the pending ring |
| placeOrder (same block, same tick group) | 93,694 | 132,650 | Steady state: slots are reused, no state growth |
| placeOrder (same block, new tick group) | 136,523 | 170,362 | |
| cancelOrder (pending) | 71,917 | 105,179 | |
| claim (2 filled bids) | 144,264 | 177,389 | |
| **clear** (2 makers + 1 taker) | 3,014,026 | **1,766,599** | 41% cheaper under Monad's page pricing |
| **clear** (10 new orders) | 6,181,156 | **3,338,309** | |
| **clear** (50 new orders) | 9,647,634 | **6,070,870** | |
| **clear** (200 new orders, 40 ticks) | 9,626,010 | **6,097,182** | Merge cost is per tick group, not per order |

## Reading the numbers

- **The auction is page-native.**
  - Level arrays, hierarchy totals and account state are 128-slot page aligned (MIP-8).
  - Under Monad's rules the same clear costs about 40% less than under Ethereum's.
  - The scans touch many slots, but few pages.
- **Clear cost is per tick group, not per order.** 200 orders across 40 ticks clear for the same gas as 50.
- **Dollar cost** at Monad's 100 gwei minimum base fee and MON ≈ $0.034:
  - a 200-order batch ≈ 0.61 MON ≈ **$0.02**;
  - an order entry ≈ 0.013 MON ≈ **$0.0005**.

## Known optimizations (tracked for the gas pass)

1. **Three-level occupancy bitmaps** (tick → bucket → super, 128 bits per word, as in Uniswap v3's tick bitmap). Prefix sums and the `nextNonEmpty` scans then read only non-empty entries, instead of sweeping up to 127 slots per level.
2. **Cache page bases** inside the scan loops, instead of recomputing `keccak` for every slot.
3. **Keeper economics.** Simulate the clear first (`eth_call`). Send it only when it trades, when pending batches exceed an age budget, or when a vault queue needs a fresh reference.
