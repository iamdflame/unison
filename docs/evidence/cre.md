# Chainlink CRE: the second opinion

Unison's mainnet auctions price at Chainlink's own observations ([causal.md](causal.md)). Two Chainlink Runtime Environment workflows in [`cre/unison/workflows`](../../cre/unison/workflows) watch the venue from outside ([the video](https://youtu.be/ZWlRxmRgO0A), 1:04):

- **`sentinel`** (every 30 s) compares the feed with the market.
  - It reads `ChainlinkCausalReference.latest` on Monad mainnet: the price, and the time Chainlink's quorum signed for it.
  - Each DON node prices MON from Coinbase and Kraken and takes the median; the nodes then agree on a median of medians.
  - It halts the market only when the feed is more than **75 bp** off that consensus **and** has been silent for more than **120 s**.
- **`halts`** (every minute) mirrors trading halts.
  - It reads Nasdaq's trading-halts feed and agrees on it across nodes.
  - It compares the result with the exchange's own halt flag (`regimeOf`) and writes a change only when the two differ.

Both act through [`CREAuditReceiver`](../../contracts/src/audit/CREAuditReceiver.sol). It accepts reports only from Chainlink's forwarder and only from our workflow owner, and calls `setHalt` on the exchange. A halt moves no funds: the next auction trades nothing and returns every waiting order unfilled. Lifting it stays with the guardian.

The repository also holds two more workflows, kept for markets that use them:
- **`audit`:** checks an operator-signed reference against Alpaca and Finnhub, as on the testnet.
- **`caps`:** daily volume caps from the 20-day average daily volume.

## Why the sentinel waits for silence

Chainlink's MON/USD feed reports on a 2 bp deviation. Its observation then takes about 13 s to land on chain ([measured](causal.md)), so during a fast move the feed legitimately trails the exchanges.

A sentinel that halted on the gap alone would stop healthy markets at exactly the moments people want to trade. A feed that is far from the market **and** has stopped updating is broken: that is the one case worth halting for.

The rule is `sentinelDecision` in [`cre/unison/src/logic.ts`](../../cre/unison/src/logic.ts). It is unit-tested (`cre/unison/test/logic.test.ts`) for four cases:
- a healthy feed during an in-flight move must not halt;
- a quiet feed that agrees with the exchanges must not halt;
- a feed that is both far off and silent halts;
- a future observation never counts as silence.

## Runs on 6 October 2026, against Monad mainnet

CRE CLI v1.36.0, `cre workflow simulate`. Reads go to `https://rpc.monad.xyz`. Writes are dry runs: the simulator prepares the halt report but does not broadcast it.

**The sentinel, production settings:**

```
cre workflow simulate unison/workflows/sentinel --target production-settings --non-interactive --trigger-index 0

2026-10-06T18:42:10Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
2026-10-06T18:42:12Z [USER LOG] MON: Chainlink round 18446744073710160400 at 28861 (observed 45 s ago) vs exchanges 28877 → 5 bp
✓ Workflow Simulation Result:
"MON:ok:5bp:45s"
```

The feed read $0.028861 and the exchanges $0.028877, 5 bp apart, with Chainlink's latest observation 45 s old, so the market keeps trading.

**The halt path, with the thresholds forced to zero** (`demo-settings`, the same code and mainnet reads):

```
cre workflow simulate unison/workflows/sentinel --target demo-settings --non-interactive --trigger-index 0

2026-10-06T18:42:34Z [USER LOG] MON: Chainlink round 18446744073710160400 at 28861 (observed 68 s ago) vs exchanges 28912 → 17 bp
✓ Workflow Simulation Result:
"MON:HALT:17bp:68s"
```

The workflow builds a `KIND_HALT` report for market 1 and writes it to the receiver, as a dry run.

**Halt mirroring, production settings:**

```
cre workflow simulate unison/workflows/halts --target production-settings --non-interactive --trigger-index 0

2026-10-06T18:44:03Z [USER LOG] NVDA: trading on Nasdaq, trading on Unison
✓ Workflow Simulation Result:
"no-change"
```

**Again on 7 October 2026, 02:26 UTC**, for the video ([full log](../../video/src/data/cre-sim.txt)):

```
$ cre workflow simulate unison/workflows/sentinel --target production-settings --non-interactive --trigger-index 0
2026-10-07T02:26:39Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
2026-10-07T02:26:41Z [USER LOG] MON: Chainlink round 18446744073710161055 at 27045 (observed 16 s ago) vs exchanges 27007 → 14 bp
✓ Workflow Simulation Result:
"MON:ok:14bp:16s"

$ cre workflow simulate unison/workflows/sentinel --target demo-settings --non-interactive --trigger-index 0
2026-10-07T02:26:49Z [USER LOG] MON: Chainlink round 18446744073710161055 at 27045 (observed 25 s ago) vs exchanges 27007 → 14 bp
✓ Workflow Simulation Result:
"MON:HALT:14bp:25s"
```

MON had fallen about 4% in the hour before; the feed was 14 bp from the exchanges and 16 s old, so the market kept trading.

## What is not live yet

- **No live DON yet.** Deploying to a DON needs CRE deploy access, which is in early access. Until then the workflows run in Chainlink's simulator, as above.
- **The receiver isn't on mainnet yet.** The contract and its tests (`contracts/test/unit/CREAuditReceiver.t.sol`) are ready. When access is granted, it is deployed with Monad's Chainlink forwarder and our workflow owner, and given `HALT_ROLE` through the timelock. Every change to roles waits in public.

## Run it yourself

```
cd cre
cre login
cre workflow simulate unison/workflows/sentinel --target production-settings --non-interactive --trigger-index 0
```

You need the [CRE CLI](https://docs.chain.link/cre) and Bun. The workflow compiles to WASM on the fly.
