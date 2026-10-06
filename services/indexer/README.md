# Unison challenge indexer (Envio HyperIndex)

Indexes the standing challenge on Monad mainnet (chain 143) with [Envio HyperIndex](https://docs.envio.dev), so every challenger, not just our own bot, has a public, live score.

- **Factory pattern.** Each `ChallengeAccount` is created by `LatencyChallenge.open()`. Its `Opened` event registers the new contract (`contractRegister`), and its `OrderSent` and `FillRecorded` events are indexed from then on.
- **Chainlink, read by observation time.** The MON/USD and AUSD/USD aggregators' `NewTransmission` events carry `observationsTimestamp`: the time inside the report Chainlink's quorum signed, the clock Unison prices by.
- **The contract's own arithmetic.** Each fill is marked at the first MON/USD observation at least 60 s after its order, over the AUSD/USD round in force then, exactly as `LatencyChallenge.edgeOf` marks it. [`src/score.ts`](src/score.ts) holds that arithmetic. [`test/score.test.ts`](test/score.test.ts) checks it against the contract's own `edgeOf` on the house adversary's real mainnet fills ([`test/vectors.json`](test/vectors.json), from `scripts/vectors.mjs`), and they agree to the unit.
- **Late settles.** A fill settled after its markout has landed is marked at once. The handler finds the observation minute by minute (`Observation.minute` is indexed), not by scanning every round.
- **Where it starts.** The chain starts at block 111,049,356, where the AUSD/USD round in force when the window opened (aggregator round 7761) landed. The challenges and MON/USD start at block 111,054,183, where Unison's challenge was deployed.

The handlers are in [`src/handlers/challenge.ts`](src/handlers/challenge.ts); Envio loads every file under `src/handlers/`.

## Entities

| Entity | What it holds |
|---|---|
| `Challenge` | One per LatencyChallenge: its rule (`causal` for Unison, `old` for the control), and whether it has paid out |
| `Account` | One per challenger: orders, fills, counted fills, fills still waiting for their markout, and edge, notional and edge in bp |
| `Fill` | One per recorded fill, with its markout round, price and edge once marked |
| `Observation`, `QuoteRound`, `Head` | Chainlink's MON/USD observations and AUSD/USD rounds |

## Run

Envio runs on Linux, macOS or WSL 2, and its local mode needs Docker. The indexer is its own pnpm project, outside the monorepo's workspace: Envio Cloud builds with pnpm 10.32, which can't read the monorepo's pnpm 12 lockfile. Its `package.json` pins `pnpm@10.32.0`, so pnpm switches to that version here, and `pnpm-lock.yaml` is pnpm 10's.

```
cd services/indexer
pnpm install
pnpm codegen
pnpm types           # the handlers, type-checked against the generated types as `envio start` checks them
pnpm test            # the arithmetic against the contract, and the handlers replaying mainnet's own events
pnpm dev             # a local indexer and GraphQL endpoint
```

CI runs codegen, the type check and both test files on every push (`.github/workflows/ci.yml`, the `indexer` job). [`test/handlers.test.ts`](test/handlers.test.ts) replays the house adversary's first fill through Envio's test indexer block for block: the AUSD/USD round in force, the `Opened` that registers the account, its order and fill, and the MON/USD rounds either side of its markout.

## Deploy on Envio Cloud

1. Sign in at https://envio.dev/app with GitHub, and install the Envio Deployments GitHub App on `iamdflame/unison`.
2. Add an indexer from that repository with:
   - **Root Directory** `services/indexer`;
   - **Config File** `config.yaml`;
   - **Deployment branch** `envio`.

   Every push to the deployment branch re-indexes from the start block, and a development plan holds three deployments. So the indexer deploys from `envio`, a branch that moves only when the indexer changes: `git push origin main:envio`.
3. Push to the branch. The build installs from this directory's own lockfile, finds `envio` 3.14.0 in its `package.json`, and `pnpm start` runs `envio start`. It indexes from block 111,049,356, and Envio Cloud's own HyperSync access needs no API token.
4. Copy the GraphQL endpoint into the site's `NEXT_PUBLIC_ENVIO_GRAPHQL_URL`, and /challenge lists every challenger from it.

## Limits

- The aggregator addresses are phase 1 of each feed. If Chainlink moves a feed to a new aggregator, its address here must change; the contract reads through the proxy and needs nothing.
- A fill is marked when its markout observation lands, over the AUSD/USD rounds landed by then. An AUSD/USD round observed before that observation but landing after it would make the contract's round in force differ from the indexer's. AUSD/USD moves rarely, so this needs two transmissions seconds apart.

## Example query

```graphql
{
  Account(order_by: { edgeBps: desc }) {
    id owner orders fills counted pendingMarks edge notional edgeBps
    challenge { id rule paid }
  }
}
```
