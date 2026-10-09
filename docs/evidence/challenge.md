# What the sniper earns, on each rule

Unison's standing challenge pays its pot to anyone whose fills, marked to Chainlink 60 seconds later, beat the venue by more than 2 bp of their notional over 30 fills or more ([the terms](../../deploy/monad-mainnet-challenge.json), [the contract](../../contracts/src/challenge/LatencyChallenge.sol)). Our own bot enters it on two markets at once: Unison's causal WMON market, and a WMON market kept on the old rule as a control.

## The live result

**On 8 October 2026 at 02:52 UTC our own sniper claimed the old-rule control's pot.** The contract scored its 30 fills against Chainlink's history at +14.35 bp of their notional (an edge of 0.003520 AUSD on 2.452306 AUSD), over the +2 bp the terms require, and paid the pot, 1 AUSD, in transaction [`0x042dae76…ed3e02`](https://monadvision.com/tx/0x042dae768917a9730eaa2cf3a06106f308af6868255fca1f816bb9becded3e02) (block 111,492,259). It came 37 hours after the account opened; the replay below predicted about 33.

The same sniper, with the same signal, on Unison's causal market: −21.1 bp a trade over 53 fills (9 October, 14:15 UTC). Its pot, 18 AUSD, stands. Having been paid, the sniper no longer trades the control.

Both legs are live on the house adversary's scoreboard (`GET https://unison-adversary-mainnet-production.up.railway.app/v1/score`) and on [/challenge](https://www.unisonfi.com/challenge); the claim can be checked from the chain alone: `cast call 0x5Ce9D9f491E2d16c94F56eD09BEa23e7109976e9 "paid()(bool)" --rpc-url https://rpc.monad.xyz`.

## The replay, before any money went in

Before putting money in either pot, we replayed that exact bot over the last week of real prices, on both rules.

**Result: on the old rule it earns +17.8 bp a trade and would claim the control's pot in about 33 hours. On the causal rule it loses 23.0 bp a trade. Over any stretch of 30 fills or more, its best was −15.8 bp, nowhere near the +2 bp the pot needs.** Every setting we tried gives the same verdict.

## The data

Measured on 6 October 2026 by [`services/adversary/scripts/backtest.mjs`](../../services/adversary/scripts/backtest.mjs). It is read-only and needs no keys:

- **Coinbase MON-USD:** 208,414 trades, from Coinbase's public trades endpoint;
- **Chainlink MON/USD on Monad mainnet:** 15,992 rounds (`0xBcD78f76005B7515837af6b50c7C52BCf73822fb`), each with its observation time (`startedAt`) and the time it landed on chain (`updatedAt`);
- **Window:** 29 September 05:00 UTC to 6 October 04:58 UTC, 168 hours. MON moved from $0.02732 to $0.02900 and fell 11% on the last day.

## The bot, replayed

The rule is the one in [`src/bot.ts`](../../services/adversary/src/bot.ts):

- It fires on a Coinbase trade priced at least the threshold away from the latest Chainlink round on chain:
  - at most once per round;
  - never while an order is still open;
  - at most once per gap.
- Each time, it sends 10 WMON on both legs with a limit 50 bp beyond the Coinbase price.

The replay makes these simplifications:

- **Timing:** orders land a second after the signal.
  - **Old rule:** the order clears a second later, at the round on chain then.
  - **Causal rule:** the order clears at the first round observed more than 2 s (the skew) after it landed, once that round is on chain.
- **The vault:** fills at its 20 bp half-spread plus 1 bp of depth; 10 WMON walks about 2.5 of its 0.33 bp ticks. The fee is 3 bp. Inventory skew is left out.
- **The mark:** each fill is marked at the first round observed 60 s or more after the order, as the contract marks it. Marks are in USD; the contract divides by AUSD/USD, a difference far below a basis point.

## Results: 7 days

**Columns:**
- **Threshold / gap:** the bot's settings.
- **Fires a day:** how often the bot trades.
- **Edge:** the leg's edge over its notional, in bp.
- **Median:** the median edge of a single fill.
- **Wins:** the share of fills with a positive edge.
- **Qualifies after:** when the control would first meet the terms.
- **Best prefix:** Unison's highest edge over any run of 30 fills or more from the start.

| Threshold | Gap | Fires a day | Control fills | Control edge | Control median | Control wins | Qualifies after | Unison fills | Unison edge | Unison median | Unison wins | Best prefix |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 25 bp | none | 397 | 2777 | +4.2 | +2.0 | 53% | 2.1 h | 2637 | −24.2 | −24.0 | 14% | −15.1 |
| 25 bp | 30 min | 38 | 267 | +5.3 | +3.2 | 56% | 18.1 h | 256 | −23.9 | −23.9 | 13% | −14.0 |
| 25 bp | 60 min | 21 | 146 | +7.0 | +2.6 | 55% | 33.6 h | 142 | −23.5 | −24.7 | 9% | −23.5 |
| 30 bp | none | 286 | 1999 | +8.2 | +6.2 | 59% | 3.7 h | 1879 | −24.6 | −24.3 | 15% | −24.2 |
| 30 bp | 30 min | 35 | 245 | +7.3 | +5.0 | 59% | 18.8 h | 238 | −23.5 | −23.8 | 11% | −17.7 |
| 30 bp | 60 min | 20 | 139 | +9.2 | +6.0 | 61% | 34.6 h | 135 | −23.2 | −21.9 | 11% | −21.2 |
| 35 bp | none | 211 | 1475 | +11.9 | +9.8 | 63% | 6.1 h | 1376 | −25.2 | −24.8 | 15% | −22.9 |
| 35 bp | 30 min | 31 | 217 | +10.9 | +8.5 | 64% | 25.7 h | 202 | −27.2 | −24.7 | 9% | −21.4 |
| 35 bp | 60 min | 18 | 129 | +10.5 | +8.3 | 64% | 37.7 h | 124 | −24.7 | −23.9 | 15% | −23.4 |
| 40 bp | none | 155 | 1088 | +17.3 | +14.8 | 68% | 8.6 h | 1009 | −24.1 | −24.1 | 17% | −20.3 |
| **40 bp** | **30 min** | **27** | **192** | **+17.8** | **+15.8** | **72%** | **33.1 h** | **179** | **−23.0** | **−24.1** | **16%** | **−15.8** |
| 40 bp | 60 min | 17 | 117 | +17.3 | +15.9 | 69% | 43.5 h | 110 | −23.5 | −24.2 | 13% | −16.7 |
| 50 bp | none | 92 | 642 | +24.6 | +20.6 | 74% | 28.1 h | 579 | −24.7 | −24.3 | 17% | −20.1 |
| 50 bp | 30 min | 22 | 152 | +30.1 | +23.6 | 80% | 40.4 h | 134 | −23.3 | −24.1 | 16% | −18.6 |
| 50 bp | 60 min | 15 | 102 | +31.2 | +23.1 | 81% | 49.0 h | 87 | −22.6 | −25.1 | 16% | −22.5 |

## Reading it

**The old rule pays the sniper, and the bigger the move, the more.** Its price is the last round on chain. A trader who saw the market move before that round was replaced buys at a price everyone else already knows is stale. Its edge rises with the threshold: +4.2 bp a trade at 25 bp, +30 bp at 50 bp.

**The causal rule doesn't.** The same signal, the same orders and the same vault lose about 23–27 bp a trade on Unison, which is the vault's half-spread plus the fee. The price is observed after the order is sealed, so seeing the move first buys nothing.

What is left is momentum. After a large move, the next minute continues it by a few basis points, which is why Unison's loss is a little smaller than the full 24 bp. To win the pot on Unison, a trader would have to predict the next minute's price by more than the spread plus the fee, the same risk any market maker takes. That is the definition working, not a gap in it.

## The live settings

The bot is set to **40 bp with a 30-minute gap**. Those settings:

- leave a clear margin on the control (+17.8 bp a trade, 72% of trades winning), so the definition is seen to pay where there is an edge;
- keep the keeper's bill small. Every trade costs one clear on each market, and Monad charges the gas limit;
- stop trading a market once its challenge has paid out.

On mainnet, the keeper charges each clear at least its 2M gas floor, about 0.2 MON at 102 gwei. The first live causal WMON clear, two orders and the vault, was charged 2.63M. That makes the keeper's gas for the bot's trades from the cutover to the end of judging about 150 MON:
- about 13 MON a day while both legs trade;
- about 7 MON a day once the control has paid out.

The keeper held 167 MON after the cutover.

## The band, and what a clear costs

On WMON's $0.000001 tick, a ±200 bp band is about 1,200 price levels a side for every clear to walk. The causal cutover narrows WMON and its control alike to ±50 bp ([`deploy/monad-mainnet-causal.json`](../../deploy/monad-mainnet-causal.json)). That is still far wider than the vault's ±20 bp quotes.

On a fork of Monad mainnet, with the same bot order and the same vault:

| WMON clear | Gas |
|---|---|
| Band ±200 bp | 2.28M–2.36M |
| Band ±50 bp | 1.28M–1.32M |

That is 44% less gas a clear.

## Run it yourself

```
cd services/adversary
node scripts/backtest.mjs                                   # the last 72 h
HOURS=168 THRESHOLDS=25,30,35,40,50 GAPS=0,1800,3600 node scripts/backtest.mjs
```

The window moves with the clock, so a rerun replays a different week. The verdict is what should hold.
