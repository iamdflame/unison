# A clock in seconds: Chainlink Data Streams on Monad (built and tested, not live)

Checked 9 and 10 October 2026. **Unison's causal rule can run on Chainlink Data Streams instead of push feeds, which would cut the wait for an auction from minutes to about 3–5 seconds without giving anyone a choice of price.** The adapter is built, and it is tested against Chainlink's real verifier on Monad with reports Chainlink's DON signed. It is not deployed: every Data Streams stream is a paid subscription, and this project's budget does not cover one yet.

## Why the clock is slow today

An order waits for the first Chainlink observation made more than 2 s after it was sealed ([the causal rule](causal.md)). Push feeds publish only when the price moves past a threshold or a heartbeat expires, and each report takes about 13 s to land. Measured on 6 October:

| Market | Today, p50 | Today, p90 |
|---|---|---|
| WMON/AUSD (MON/USD, 2 bp deviation) | 34 s | 1.2 min |
| aNVDA/AUSD in US market hours (wNVDAx-USD, 5 bp) | 1.5 min | 5.3 min |
| aNVDA/AUSD outside US market hours | 15.2 min | 36.8 h |

## The same rule on a pull oracle

Data Streams is a pull oracle. Its DON signs a report about once a second, and anyone can fetch a report and verify it on chain. A report covers a window of oracle time, from `validFromTimestamp` to `observationsTimestamp`. Chainlink builds the windows contiguous: each starts right after the previous one ended, and a gap widens the next window ([How report timestamps work](https://docs.chain.link/data-streams/how-report-timestamps-work)).

So exactly one report's window holds the second after `seal + 2 s`, and that report is the first observation after it: its own observation is later, its predecessor's is not. This is the push adapter's proof ("round r after the seal, round r−1 not") with the predecessor read from the window. Whoever brings the report chooses nothing, and the exchange does not change.

Every report verified on Monad so far has a one-second window (`validFromTimestamp == observationsTimestamp`): one report per second, each starting where the last ended.

**The assumption is Chainlink's.** If two reports for the same stream ever covered the same second, the submitter could pick between them. The choice is bounded by one second of price movement, and nothing we have seen shows it happening.

## What is on Monad mainnet

- **The verifier is live and free.** `VerifierProxy 2.0.0` at [`0xEd813D895457907399E41D36Ec0bE103E32148c8`](https://monadscan.com/address/0xEd813D895457907399E41D36Ec0bE103E32148c8). It has no fee manager and no access controller: anyone can verify a report for the gas alone.
- **It has been used six times since November 2025.** We decoded every one:
  - three ETH/USD reports (schema 3);
  - two from an RWA stream (schema 8, market status "open");
  - one NAV report (schema 9).

  All six were signed under one DON configuration, with six signatures each.
- **Two of those reports still verify today,** and our adapter accepts them. In CI, the "Mainnet rehearsals" job forks Monad mainnet at the current block (112,028,817 on the first run). [`StreamsFork.t.sol`](../../contracts/test/fork/StreamsFork.t.sol) submits the real signed reports through the adapter, reads them back, and shows that a report altered by one wei is refused.
- **Cost:** one report verified and stored costs 281,884 gas, about 0.03 MON at 102 gwei.

## The streams that would price aNVDA

From Chainlink's public discovery endpoint (`/api/v1/discovery`, no key needed). NVDA comes as three streams, one per session, all schema 11 (bid, ask, mid, last trade, market status):

| Session | Feed ID |
|---|---|
| Regular hours | `0x000b6aa036224454037bab103184565f6aa9ea589c3b349f6d8471ee753524b9` |
| Extended hours | `0x000bb043961643d051393c085a4dd0cded6f67b4b71e47e9dcec739b7b3e2145` |
| Overnight | `0x000b47988e89f3e63e1d679c84b774e6c38bb9929ad9de6e5e56d657a80388a9` |

These are NVIDIA's own price. aNVDA is Anchored's token, and today it is priced from Chainlink's wNVDAx-USD, which tracks Backed's token. None of the three is the same asset, and the trade ticket says which price it uses.

## What it costs, and what changed since the plan

- **Data Streams:** $150 a month per stream when we checked, through Chainlink's sales. A regular-hours aNVDA needs one stream ($150 a month); a 24/5 aNVDA needs all three ($450 a month).
- **Pyth is no longer the self-serve path.** Our plan picked Pyth first, because `parsePriceFeedUpdatesUnique` proves the first update after a time just as well. But since Pyth's Core upgrade on 31 July 2026 ([announcement](https://www.pyth.network/blog/the-pyth-core-upgrade)), every Pyth data API needs a paid plan:
  - Starter: $500 a month, with no equities.
  - US Equities: $5,000 a month.

  Pyth also moved extended-hours equity feeds to its paid Pro tier on 15 June ([announcement](https://www.pyth.network/blog/extended-hours-us-equity-data-moves-to-pyth-pro)). Data Streams is now the cheaper proof by a factor of about thirty.
- **Neither fits this project's budget** (under $100 a month). The adapter waits for funding or a data grant.

## What the adapter does

[`StreamsCausalReference.sol`](../../contracts/src/pricing/StreamsCausalReference.sol):

- **`submit(report)`** is permissionless. It verifies the signed report with Chainlink's verifier and stores its price, window and session under its observation time. A report already stored is skipped without calling the verifier.
- **`readAfter`** is what the unchanged exchange calls. Its payload names a stored report, and the adapter checks the window rule.
  - The report must be observed after the seal plus the skew.
  - Its window must hold the second after that time.
  - Otherwise it reverts: `NotAfterSeal`, `NotFirstObservation` or `NotSubmitted`.
- **Sessions come from Chainlink**, through each report's `marketStatus`, holidays and early closes included.
  - Each market lists the sessions its stream is live in. Regular hours read OPEN; a live pre-market, post-market or overnight session reads EXTENDED.
  - Any other session reads CLOSED and is priced by call auctions. A market on the regular-hours stream is therefore closed overnight, never priced from a stale regular-hours mid.
- **When not to trade:** an unknown status, a mid that stopped updating in a live session, or AUSD off its peg reads HALTED, and the exchange returns the orders.
- **Weekends** keep producing reports, with a closed status. Each weekend auction is a call auction bounded by its report. Exchange v3 clears such an auction at once instead of making it wait for the call-auction cadence. Before v3, the cadence could have held those orders forever (fixed in [the A1 upgrade](../ROADMAP.md)).
- **`latest`** serves only a report observed in the last `maxLatestAgeSec` seconds. An empty auction (a vault's queue) therefore can't run at an old price someone chose to bring.
- **[`ClearRouter`](../../contracts/src/pricing/ClearRouter.sol)** submits the report and clears the auction in one transaction, and passes the exchange's keeper reward to the caller. The keeper uses it, and so could a "settle this auction" button on the ticket.

Tests: [`StreamsCausalReference.t.sol`](../../contracts/test/unit/StreamsCausalReference.t.sol) checks the rule, every session code, the quote leg, stale mids and the router, against the real exchange; the fork test above uses the real verifier.

## Limits

- **No proof of absence.** A pull oracle can't prove that no report exists, so there is no "feed silent, so the market is closed" path. If reports stop, orders wait until the guardian halts the market, which returns them.
- **Fees.** If Chainlink adds a fee manager on Monad, `submit` reverts until a funded adapter replaces this one.
- **Not wired end to end yet:**
  - the keeper's API client (signed requests to `api.dataengine.chain.link`);
  - the receipt checker and the tape, which read push-feed rounds today.

  They come with a subscription.
- **Latency target, stated honestly:** the first report after `seal + 2 s` arrives about 3 s after the seal, plus fetching and landing it. A p50 of 3–5 s, against 34 s to 15 min today.
