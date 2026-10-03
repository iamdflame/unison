# Fairness evidence: who pays the latency sniper? (2026-10-03)

**Benchmark:** `research/sniper-bench` (`pnpm --filter @unison/sniper-bench bench`).

All five venue configurations see the same scenario:

| Input | Value |
|---|---|
| Price path | 1,000,000 Monad blocks of 300 ms (83 h), GBM at σ = 45%/yr plus 24 news jumps/day of 40 bp (NVDA-like, after-hours included) |
| Uninformed flow | ≈$2.9M/day (1.4× LP capital) |
| Sniper | Sees the true price mid-block and trades whenever it sees an edge, up to $50k per trade |
| LP risk budget | $2M of capital, about 2.5–4% of it quoted per side |

The Unison rows run the **actual clearing engine** (`@unison/engine`, bit-exact with the contracts):
- one uniform price per block;
- exact pro-rata allocation;
- the LiquidityVault curve centred on the reference that is **published after the batch closes**.

| Venue | Sniper P&L / day | LP or maker P&L / day | Noise-trader cost | Sniper fills / day |
|---|---:|---:|---:|---:|
| xy=k AMM (fee 30 bp) | $6,171 | $13,459 | 69.1 bp | 12,563 |
| Push-oracle AMM (±10 bp, 50 bp deviation trigger) | $473 | $2,175 | 9.3 bp | 63 |
| CLOB + market makers (±2 bp, sniper wins 50% of races) | $487 | $84 | 2.0 bp | 5 |
| **Unison** (vault ±10 bp, fee 3 bp) | **$0** | $2,858 | 13.0 bp | **0** |
| **Unison** (vault ±2 bp, fee 1 bp) | **$0** | **$646** | 3.3 bp | **0** |
| Unison with a **stale** reference (rule broken on purpose) | $1,000 | $1,740 | 13.0 bp | 8 |

## What it shows

1. **Sniping is structurally unprofitable on Unison.**
   - The sniper's information is at most mid-batch.
   - The auction prices against a reference published after the batch closed.
   - So the sniper only fills when the price has moved against it (a winner's curse), and it stops trading.
2. **The same spread pays 7.7× more.** At an identical ±2 bp quote:
   - CLOB makers keep $84/day after snipers take $487/day;
   - Unison's vault keeps $646/day and loses nothing to snipers.

   Liquidity providers can quote tighter, and uninformed traders benefit.
3. **The rule is the mechanism.** Break "reference published after the batch closes" (last row) and the sniper's edge comes back immediately. That's why the venue enforces it on-chain:
   - `OperatorSignedReference` binds each signature to the batch and checks the publish time;
   - the exchange rejects any reference published before the newest batch closed.
4. **Passive AMM LPs pay for latency twice.** First as LVR to arbitrageurs, then as the price impact uninformed traders inflict on them.

## Assumptions and limits (stated, not hidden)

- **Stylized actors:**
  - one sniper with a perfect mid-block feed;
  - CLOB makers refresh with one block of latency, and races are coin flips;
  - push-oracle depth replenishes on each oracle update;
  - Unison's relay has zero measurement lag at the batch close.
- **Relay lag.** A relay lagging the true price by δ gives back an edge of order σ·√δ. Over tens of milliseconds that is far below a 2 bp spread, except during news. DISCOVERY bands and LULD bands cap the damage there.
- **Synthetic flow.** No inventory risk aversion or strategic market makers are modelled. Uninformed flow is i.i.d.
- **Live data supersedes this.** The live-mainnet print and fill data (indexer tape) will replace the simulation numbers as they accumulate.
