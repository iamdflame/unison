# Static analysis: Slither, triaged (9 October 2026)

[Slither](https://github.com/crytic/slither) over `contracts/src` (dependencies, tests and scripts filtered out, informational and optimization detectors off: [`contracts/slither.config.json`](../../contracts/slither.config.json)) reported **91 results from 12 detectors** on the Phase A code. CI runs it on every change ("Static analysis"), reporting without blocking until every result has a verdict here. This page is that verdict.

**One real issue, in the vaults: a redemption the token refuses stops the whole queue.** Everything else is intended behaviour, or code that isn't deployed.

| Detector | Results | Verdict |
|---|---:|---|
| `calls-loop` | 11 | **One real issue** (below). The rest are bounded: a user's own batch of orders (`OrderGateway.placeBatch`), the fills of one challenge account (`LatencyChallenge.edgeOf`), the issuer-denylist sources the owner lists (`EligibilityRouter`, `IssuerDenylistEligibility`), the CRE receiver's cap list. |
| `timestamp` | 23 | Intended. Deadlines, sessions, oracle ages, daily caps and the challenge's window are rules about time. Monad's block time is set by consensus; the causal rule never trusts it alone (an observation must come more than `skewSec` after the seal). |
| `unused-return` | 13 | Intended: fields of a returned tuple the caller doesn't need (`tryRecover`'s error argument, `getRoundData`'s round ids, `BookStore.fill`'s snapshot). The returned errors are checked. |
| `uninitialized-local` | 13 | Intended: structs and counters that start at zero by design (an order record built field by field, `Clearing.compute`'s best index). |
| `reentrancy-events` | 11 | No risk: the calls are to the exchange, a trusted contract (from the gateway, the challenge accounts and the CRE receiver), or to curve sources inside `clear`, which holds the transient reentrancy guard every state-changing entry point shares. |
| `incorrect-equality` | 6 | Intended exact comparisons: a pending slot's batch tag (`== batch`), the UTC day of a cap, empty-book checks. |
| `missing-zero-check` | 5 | Low. `ChallengeAccount` is created only by `LatencyChallenge.open` with the caller as owner. `PythReference` isn't deployed. |
| `reentrancy-no-eth` | 4 | No risk: `_clear` calls the reference adapter (a view) and curve sources (a static call, from v2 a bounded low-level one) under the exchange's reentrancy guard. |
| `reentrancy-benign` | 2 | No risk: `ChallengeAccount` writes after calling the exchange, which can't call back into it. |
| `divide-before-multiply` | 2 | Intended. `_band` rounds the reference to a tick first, which defines the band (the web app mirrors it to the tick); the vault's per-tick quote floors before it is compared with its cap, the conservative side. |
| `weak-prng` | 1 | Not randomness: the pending ring's slot is a block number modulo the ring's size. |
| `pyth-unchecked-confidence` | 1 | `PythReference` isn't deployed. The Pyth causal adapter in Phase B must check the confidence interval (as `maxConfBps` intends). |

## The real issue: one frozen recipient stops a vault's queue

`LiquidityVault.process()` settles the queue of deposit and redemption requests in order, in one loop. A redemption pays the LP by transferring tokens out (`venue.withdraw(token, amount, owner)`). If the token refuses that transfer, because Anchored froze the LP's address on aNVDA or Agora froze it on AUSD after the request was queued, the whole call reverts, the request can't be skipped, and every request behind it waits forever.

- **Who is exposed today:** nobody but the team, which is the only LP in all three vaults.
- **The fix, built (10 October) in `LiquidityVault` v2:**
  - A redemption the token or the exchange refuses is held for its owner, and the queue moves on. The held amount leaves the vault's ledger balance for the vault contract itself, so it is neither quoted nor counted in NAV.
  - `claim` retries it later through the exchange, under the same checks as any withdrawal. It pays only the owner, and only once the issuer allows it.
  - [`LiquidityVaultQueue.t.sol`](../../contracts/test/unit/LiquidityVaultQueue.t.sol) freezes a redeemer with a mock issuer: the LPs behind are paid, the held amount stays out of the curve, and `claim` works only after the freeze lifts.
  - The deployed vaults are v1 and immutable, so v2 ships as new vaults, before any outside LP deposits ([roadmap](../ROADMAP.md), C).

Reproduce: `pip install "slither-analyzer>=0.11,<0.12"`, then from `contracts/`: `forge build --build-info --skip test script && slither . --ignore-compile --config-file slither.config.json`.
