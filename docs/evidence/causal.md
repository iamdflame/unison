# The oracle is the clock

On Unison's mainnet markets an auction prices at **the first Chainlink observation made after its orders were sealed**. The price did not exist when anyone in the auction placed an order. Nobody can choose a different one: not a trader, not the keeper, not Unison.

This page covers:
- why the rule changed;
- how it is enforced;
- what it costs in waiting time;
- what the old rule leaked, measured on Monad mainnet;
- how to check all of it yourself.

## What was wrong

The mainnet beta launched on 5 October 2026 reading Chainlink's push feeds through `ChainlinkReference`. That adapter returned the **clear's own block time** as the reference time (`publishTimeMs = block.timestamp * 1000`). So the exchange's rule "the reference must be published after the batch closed" passed for every clear, whatever the feed's real age.

The vault quoted a price observed up to an hour earlier, and the receipt said it was new. Vault deposits settled on the same clock.

A trader watching the market sees a new price before it lands on chain, and the old rule kept quoting the previous one. That gap was real and frequent: see [the old rule's gap](#what-the-old-rule-leaked).

## Chainlink already signs the time it observed

Every feed Unison uses on Monad is an OCR2 aggregator: `AccessControlledOCR2Aggregator` (MON/USD, GBP/USD, AUSD/USD) or `DualAggregator` (wNVDAx-USD). In OCR2:
- the report the oracle quorum signs is `(uint32 observationsTimestamp, observers, observations, juelsPerFeeCoin)`;
- the signatures cover `keccak256(report)`;
- `latestRoundData` and `getRoundData` return that observation time as **`startedAt`**. `updatedAt` is only the block time the report landed.

Checked on chain on 6 October 2026, across 8,100 rounds of MON/USD, wNVDAx-USD and GBP/USD:
- the observation came **before** the report landed in every round, typically 13 s before;
- observation times **never went backwards**.

The feeds keep their history, so a contract can prove that round `r` was observed after a moment `T` and round `r − 1` was not. That makes `r` the first observation after `T`. Pyth sells this guarantee as `parsePriceFeedUpdatesUnique`; here it is free and needs no key at all.

## The rule

Enforced in the exchange's clear job ([`ExchangeClearing._causalReference`](../../contracts/src/core/ExchangeClearing.sol)) and the adapter ([`ChainlinkCausalReference`](../../contracts/src/pricing/ChainlinkCausalReference.sol)), [SPEC §7.4](../SPEC.md):

1. **The price.**
   - The auction for the oldest waiting order prices at the first Chainlink observation made more than 2 s (`skewSec`) after that order was registered. The 2 s covers clock differences between Chainlink's nodes and Monad's validators.
   - Whoever clears names the round, and the contract checks it is the first.
2. **Who is in.** Exactly the orders registered before that observation (less the 2 s), and none after. The contract derives the batch itself, so a keeper can't leave a sealed order out or slip a later one in.
3. **Sealed.**
   - Orders on these markets are auction orders: each joins one auction, and what doesn't fill comes back.
   - A waiting order can't be cancelled. Otherwise a trader could watch the market during the 13 s an observation takes to land, and cancel only when the coming price hurt them.
4. **The time.**
   - The receipt's `refTimeMs` is Chainlink's observation time, and it never goes backwards.
   - The adapter refuses any round whose observation time isn't strictly before its arrival, so the chain's clock can never pass for an observation.
5. **Closed.**
   - If no observation after the orders exists and the session is closed (aNVDA on weekends), or the feed has been silent past its heartbeat, the market runs a call auction among traders.
   - The vault does not quote then.
   - The receipt carries the last observation with its true, old time.
6. **The quote feed.**
   - The AUSD/USD round used is the one in force at the base observation, so that is fixed by history too.
   - If AUSD drifts more than 50 bp from $1, the market halts.

Vault deposits and redemptions settle at a reference observed after the request, on the same clock.

## What it costs: the wait

An order waits for the next observation. Measured with [`apps/web/scripts/measure-causal.mjs`](../../apps/web/scripts/measure-causal.mjs) on 6 October 2026 (Monad block 110,926,157). For an order placed at a random moment, this is the time until the first observation after it is on chain:

| Feed | Market | Rounds | p50 | p90 | p99 |
|---|---|---|---|---|---|
| MON/USD (2 bp deviation, 1 h heartbeat) | WMON/AUSD | 6,000 over 68.6 h | **34 s** | 1.2 min | 2.2 min |
| wNVDAx-USD (5 bp, 1 h, 24/5) in US market hours | aNVDA/AUSD | 1,500 over 139.9 h | **1.5 min** | 5.3 min | |
| wNVDAx-USD outside US market hours | aNVDA/AUSD | | 15.2 min | 36.8 h (weekends: call auctions instead) | |
| GBP/USD (15 bp, 4 min heartbeat) | not listed | 600 over 41.8 h | 2.3 min | 4.0 min | 4.6 min |

Observation to on chain: p50 13 s and p90 13 s on all three feeds; at most 17 s for MON/USD and 32 s for wNVDAx-USD.

WMON/AUSD is the market this rule fits best: the feed moves on 2 bp and never closes. The ticket states the wait before you trade.

## What the old rule leaked

Each new observation is known to anyone watching the market before it lands on chain, which takes about 13 s. During that time the old rule still priced at the previous observation. The table shows how far each observation moved from the one before it:

| Feed | p50 | p90 | p99 | max | Moves over the vault's spread + fee |
|---|---|---|---|---|---|
| MON/USD | 6.2 bp | 17.6 bp | 47.2 bp | 166.9 bp | over 23 bp (WMON vault 20 bp + fee 3 bp): **6.1% of rounds, 5.3 an hour** |
| wNVDAx-USD | 6.7 bp | 11.5 bp | 22.9 bp | 39.2 bp | over 13 bp (aNVDA vault 10 bp + fee 3 bp): 7.1% of rounds, 0.8 an hour |

So under the old rule, a bot watching MON on any exchange had about five chances an hour to buy from the WMON vault below where Chainlink was about to print, or sell to it above. Under the causal rule, the same order prices at an observation made after it, and that edge is gone by construction.

The challenge market (`WMON/AUSD (old rule)`, market 2) keeps the old rule live on purpose, with the same vault settings, so anyone can measure the difference.

## Rehearsed before mainnet

- **Unit and invariant tests** ([`CausalReference.t.sol`](../../contracts/test/unit/CausalReference.t.sol), [`CausalInvariant.t.sol`](../../contracts/test/invariant/CausalInvariant.t.sol)):
  - 21 cases: not the first round, an order left out, a later order slipped in, a cancel while sealed, time running backwards, a chain-clock round, the quote round, a depeg, closed and silent feeds, vault settlement, and chunked versus single-shot clears;
  - 16,384 random calls with zero sealed cancels, zero batch errors, zero time reversals and zero chain-clock references;
  - a source check that the adapter never writes `block.timestamp` into a reference time.
- **Fork tests on mainnet state** ([`CausalFork.t.sol`](../../contracts/test/fork/CausalFork.t.sol), block 110,918,652):
  - the live exchange proxy upgrades in place with every market and balance unchanged;
  - two traders cross 10,000 WMON at the first real MON/USD observation after their orders;
  - the live aNVDA vault buys 0.005 aNVDA at the first real wNVDAx observation after the order.
- **The services on a fork:** the keeper and the tape ran against the upgraded fork.
  - The keeper waited for the observation, ignored one inside the 2 s margin, then cleared and settled.
  - A cancel while sealed reverted.
  - The tape served the print with `rule: "causal"`, its own `causal: true` verdict, and an unbroken receipt chain.

## A bug found on the way

The exchange keeps waiting orders in a ring addressed by block number modulo 256. It reused a slot even while another waiting batch still held it. Two waiting batches exactly 256 blocks apart (about 100 s) overwrote each other, and the older batch's orders could never settle.

Clearing every block had hidden it. Waits measured in tens of seconds would have hit it.

The fix:
- a slot is never reused while its batch waits;
- the ring now spans 65,536 blocks (about 7 hours).

[`PendingRing.t.sol`](../../contracts/test/unit/PendingRing.t.sol) fails on the old code and passes on the new.

## Check it yourself

- **Chainlink's history:** `node scripts/measure-causal.mjs` from `apps/web` reproduces every number on this page from the feeds' own history.
- **Any print on the tape:** `GET /v1/markets/:id/prints` returns, for each auction:
  - `sealedAt`, the newest order's block time;
  - `refTimeMs`, Chainlink's observation time;
  - `ts`, when it cleared;
  - `round`, the Chainlink round;
  - `causal`, the tape's own check that the observation came after the seal.
- **The round itself:** `getRoundData(round)` on the feed returns `startedAt`, and that must equal `refTimeMs / 1000`.

## What is still open

- **Order visibility.** A waiting order is visible on chain until its auction runs. With one price per auction and sealed cancels, seeing it buys no better price; it is still order-flow information. A commit–reveal seal would hide it. That is designed and not built.
- **The gasless relayer** can delay a signed order until its deadline (60 s on these markets), but cannot change it. Anyone can submit a signed order directly.
- **Vault-only clears** (no orders waiting) use the latest observation at the moment someone clears. Anyone can trigger one right after a request.
- **Ring capacity.** An attacker who places orders in 65,536 distinct blocks within one auction's wait could fill the ring. New orders would revert until the next clear; none would be lost.
