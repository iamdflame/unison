# Unison challenge indexer (Envio HyperIndex)

Indexes the standing challenge on Monad mainnet (chain 143) with [Envio HyperIndex](https://docs.envio.dev), so every challenger, not just our own bot, has a public, live score.

- **Factory pattern.** Each `ChallengeAccount` is created by `LatencyChallenge.open()`. Its `Opened` event registers the new contract (`contractRegister`), and its `OrderSent` and `FillRecorded` events are indexed from then on.
- **Chainlink, read by observation time.** The MON/USD and AUSD/USD aggregators' `NewTransmission` events carry `observationsTimestamp`: the time inside the report Chainlink's quorum signed, the clock Unison prices by.
- **The contract's own arithmetic.** Each fill is marked at the first MON/USD observation at least 60 s after its order, over the AUSD/USD round in force then, exactly as `LatencyChallenge.edgeOf` marks it. [`src/score.ts`](src/score.ts) holds that arithmetic. [`test/score.test.ts`](test/score.test.ts) checks it against the contract's own `edgeOf` on the house adversary's real mainnet fills ([`test/vectors.json`](test/vectors.json), from `scripts/vectors.mjs`), and they agree to the unit.
- **Late settles.** A fill settled after its markout has landed is marked at once. The handler finds the observation minute by minute (`Observation.minute` is indexed), not by scanning every round.

## Entities

| Entity | What it holds |
|---|---|
| `Challenge` | One per LatencyChallenge: its rule (`causal` for Unison, `old` for the control), and whether it has paid out |
| `Account` | One per challenger: orders, fills, counted fills, fills still waiting for their markout, and edge, notional and edge in bp |
| `Fill` | One per recorded fill, with its markout round, price and edge once marked |
| `Observation`, `QuoteRound`, `Head` | Chainlink's MON/USD observations and AUSD/USD rounds |

## Run

Envio runs on Linux, macOS or WSL 2, and its local mode needs Docker.

```
pnpm install
pnpm codegen
pnpm test            # the arithmetic against the contract, and the handlers on simulated events
pnpm dev             # a local indexer and GraphQL endpoint
```

CI runs codegen and both test files on every push (`.github/workflows/ci.yml`, the `indexer` job). The hosted indexer runs on Envio Cloud from this directory, and https://www.unisonfi.com/challenge reads its GraphQL endpoint.

## Example query

```graphql
{
  Account(order_by: { edgeBps: desc }) {
    id owner orders fills counted pendingMarks edge notional edgeBps
    challenge { id rule paid }
  }
}
```
