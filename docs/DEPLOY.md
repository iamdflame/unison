# Deploying the services (Fly.io)

Four Fly apps run the off-chain side of Unison, all in `iad` and all built from one image recipe (`ops/docker/service.Dockerfile`, one `SERVICE` build argument per app):

| App | Service | Exposure | State |
|---|---|---|---|
| `unison-relay` | reference relay (`services/relay`) | **internal only**: `http://unison-relay.internal:8787` | none |
| `unison-keeper` | keeper (`services/keeper`) | none (a worker, no HTTP service) | none |
| `unison-relayer` | gasless relayer (`services/relayer`) | public HTTPS, `/health` checked | volume `relayer_data` → `/data` (job store) |
| `unison-tape` | tape (`services/tape`) | public HTTPS + SSE, `/health` checked | volume `tape_data` → `/data` (SQLite index) |

Every app keeps one machine running (`auto_stop_machines = "off"`, `min_machines_running = 1`). Run exactly **one** machine each:

- The relayer manages one account's nonces in memory.
- The keeper races itself if duplicated.
- The tape's database lives on its volume.

The `fly.toml` files default to Monad testnet (`DEPLOYMENT=/app/deployments/monad-testnet.json`). For mainnet, see [Mainnet](#mainnet).

## 0. Prerequisites

- `flyctl`, logged in (`fly auth login`).
- The deployment document committed under `deployments/` (the image copies `deployments/` and the services read `DEPLOYMENT`). Add `startBlock` to it: the tape starts indexing there (default 0).
- A dedicated RPC endpoint (HTTP, plus WebSocket for the tape). The public Monad RPC rate-limits and caps `eth_getLogs` at 100 blocks; the tape copes (100-block windows, backoff on 429), but a backfill is much faster on a dedicated endpoint.
- Funded keys: relayer (it pays every relayed action's gas) and keeper (clears). The relay key must be a registered signer of the operator reference adapter (`relaySigners` in the deploy config).

## 1. Secrets

| App | Secret | What it is |
|---|---|---|
| `unison-relay` | `RPC_URL` | HTTP RPC (reads the chain head to bind reports to batches) |
| | `RELAY_PRIVATE_KEY` | signs references; registered in `OperatorSignedReference` |
| | `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` | market data (`PROVIDER=alpaca`) |
| | `RELAY_ADMIN_TOKEN` | bearer token for `POST /halt/:marketId` |
| `unison-keeper` | `RPC_URL` | HTTP RPC |
| | `KEEPER_PRIVATE_KEY` | sends clears, vault `process()` and auto-claims (needs MON) |
| `unison-relayer` | `RPC_URL` | HTTP RPC |
| | `RELAYER_PRIVATE_KEY` | pays gas for every relayed action and runs the faucet (needs MON) |
| `unison-tape` | `RPC_URL` | HTTP RPC (backfill and the reconciliation poll) |
| | `RPC_WS_URL` | WebSocket RPC (`logs` + `monadNewHeads`); optional but recommended |

Non-secret settings (ports, `DEPLOYMENT`, `CORS_ORIGINS`, `RELAY_URL`, `FAUCET`, `CLEAR_GAS`, …) live in each `fly.toml` `[env]`. Every variable is documented at the top of its service's `src/main.ts`.

## 2. First deploy

Run everything from the repository root. Don't use `fly launch`: it rewrites `fly.toml`.

```bash
# apps
fly apps create unison-relay
fly apps create unison-keeper
fly apps create unison-relayer
fly apps create unison-tape

# volumes (same region as the machines)
fly volumes create tape_data    --app unison-tape    --region iad --size 10 --yes
fly volumes create relayer_data --app unison-relayer --region iad --size 1  --yes

# secrets (--stage: applied by the first deploy)
fly secrets set --app unison-relay --stage \
  RPC_URL=https://… RELAY_PRIVATE_KEY=0x… ALPACA_KEY_ID=… ALPACA_SECRET_KEY=… \
  RELAY_ADMIN_TOKEN="$(openssl rand -hex 32)"
fly secrets set --app unison-keeper  --stage RPC_URL=https://… KEEPER_PRIVATE_KEY=0x…
fly secrets set --app unison-relayer --stage RPC_URL=https://… RELAYER_PRIVATE_KEY=0x…
fly secrets set --app unison-tape    --stage RPC_URL=https://… RPC_WS_URL=wss://…

# deploy: the relay first (the keeper and the tape read it); the relay never gets a public IP
fly deploy . --config services/relay/fly.toml   --dockerfile ops/docker/service.Dockerfile --no-public-ips
fly deploy . --config services/keeper/fly.toml  --dockerfile ops/docker/service.Dockerfile --no-public-ips
fly deploy . --config services/relayer/fly.toml --dockerfile ops/docker/service.Dockerfile
fly deploy . --config services/tape/fly.toml    --dockerfile ops/docker/service.Dockerfile
```

The build argument (`SERVICE`) comes from each `fly.toml` `[build.args]`. The image:

- runs the service's TypeScript directly (`node --conditions=development`);
- keeps the pnpm workspace layout, because Node won't strip types inside `node_modules`;
- runs as the unprivileged `node` user under `tini`;
- has an entrypoint that chowns the mounted volume first.

## 3. Verify

```bash
fly ips list --app unison-relay        # must be empty: internal only
curl -s https://unison-relayer.fly.dev/health   # { ok, relayer, chainId, queued, faucet }
curl -s https://unison-tape.fly.dev/health      # { ok, chainId, head, indexed, lagBlocks, startBlock }
curl -sN "https://unison-tape.fly.dev/v1/stream?topics=heads"   # one `head` per block, keepalive every 15 s

# the relay from inside the private network (the image has node, not curl)
fly ssh console --app unison-keeper -C "node -e \"fetch('http://unison-relay.internal:8787/health').then(r => r.text()).then(console.log)\""

fly logs --app unison-keeper           # one JSON line per clear / vault process / claim
```

A fresh tape backfills from `startBlock` before `lagBlocks` drops to ~0. The tape answers `/health` throughout, so the check passes while it catches up.

## 4. Day 2

| Task | Command |
|---|---|
| Redeploy after a change | the same `fly deploy …` line for that app |
| Roll back | `fly releases --app <app> --image`, then `fly deploy --app <app> --config services/<svc>/fly.toml --image <previous image>` |
| Rotate a secret | `fly secrets set --app <app> NAME=value` (restarts the machine) |
| Halt a market's reference (relay) | `fly ssh console --app unison-relay -C "node -e \"fetch('http://localhost:8787/halt/0?on=1',{method:'POST',headers:{authorization:'Bearer '+process.env.RELAY_ADMIN_TOKEN}}).then(r=>r.text()).then(console.log)\""` |
| Rebuild the tape index | `fly ssh console --app unison-tape -C "rm -f /data/tape.db /data/tape.db-wal /data/tape.db-shm"` then `fly machine restart --app unison-tape` |
| Grow the tape volume | `fly volumes extend <volume-id> --app unison-tape --size 20` |
| Custom domains | `fly certs add tape.unison.trade --app unison-tape`, `fly certs add relayer.unison.trade --app unison-relayer` |

The web app reads two URLs:

- `NEXT_PUBLIC_TAPE_URL=https://unison-tape.fly.dev`
- `NEXT_PUBLIC_RELAYER_URL=https://unison-relayer.fly.dev`

Keep both services' `CORS_ORIGINS` in step with the web app's origins.

## Railway and Vercel (the live testnet setup)

The public testnet runs the same four services on **Railway** and the web app on **Vercel**, both driven from their CLIs.

### Web (Vercel)

- Project `unison`. Root directory `apps/web`, Node 24, install `pnpm install --frozen-lockfile`, build `pnpm build`.
- Deploy from the repository root with `vercel deploy --prod`. `.vercelignore` keeps env files, keys and local folders out of the upload.
- Production URL: https://www.unisonfi.com (the apex redirects to www). https://unison-omega.vercel.app stays up: a passkey is bound to the domain it was made on, so accounts created there only open there.
- `CORS_ORIGINS` on every Railway service lists both domains.
- Environment: `NEXT_PUBLIC_SITE_URL` (absolute URLs in the sitemap and share images). Once the testnet is deployed, also
  `NEXT_PUBLIC_NETWORK=testnet`, `NEXT_PUBLIC_CHAIN_ID=10143`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_TAPE_URL` and
  `NEXT_PUBLIC_RELAYER_URL`, then redeploy. With none of them set, the app runs as the labelled browser simulation.

### Services (Railway)

- Project `unison`, one service per process: `unison-relay`, `unison-keeper`, `unison-relayer`, `unison-tape`.
- Every service builds `ops/docker/railway.Dockerfile` (the Fly recipe without BuildKit cache mounts, which Railway
  rejects) through `RAILWAY_DOCKERFILE_PATH`, with `SERVICE` selecting the process.
- Variables mirror the `[env]` and secrets of the matching `fly.toml`. The keeper and tape reach the relay privately at
  `http://unison-relay.railway.internal:8787`; the relay has no public domain.
- Volumes at `/data`: `unison-relayer` (job store) and `unison-tape` (SQLite index).
- Public domains: https://unison-relayer-production.up.railway.app and https://unison-tape-production.up.railway.app.
- `CORS_ORIGINS` is the Vercel URL; add the custom domain when it exists.
- From Git Bash, prefix CLI calls that pass paths with `MSYS_NO_PATHCONV=1`, or `/data` becomes a Windows path.
- `railway volume --service` takes the service **ID**, not its name.

### Order of the first deploy

1. Fund the deployer with testnet MON, then deploy the contracts:
   `forge script script/Testnet.s.sol --rpc-url monad_testnet --broadcast --slow` with `DEPLOYER_PRIVATE_KEY`, `KEEPER`,
   `RELAY_SIGNER`, `RELAYER` and `GAS_TOPUP_WEI` set. It writes `deployments/monad-testnet.json`; add `startBlock` and
   commit it (addresses are public).
2. `railway up --service <name>` for each service, from the repository root.
3. Set the web app's `NEXT_PUBLIC_*` variables to the Railway URLs and redeploy it.

Keys live only in `.secrets/testnet.env` (git- and Vercel-ignored) and in each platform's variable store.

### What the first testnet run taught

- **Gas.** Monad charges the gas limit. The testnet lists three markets (`MARKETS=3`, about 3.2 MON to deploy); the
  keeper runs with `CLEAR_GAS=auto` (estimate × 1.2, floor 2M) and only clears an auction that trades, merges stale
  orders, or gives a waiting vault queue its first post-request reference. A vault request that already has one is
  processed without a clear.
- **RPC limits.** The public endpoint allows 15 requests a second per IP, and Railway's services share egress. The
  keeper uses `https://rpc.ankr.com/monad_testnet`; the tape, relayer and relay use `https://testnet-rpc.monad.xyz`.
  thirdweb's endpoint answered slowly and once hung for 20 minutes, which stalled the tape's start.
- **First trade.** Fresh vaults hold only AUSD, so the first fill is a sale into their bid; buys fill once someone has
  sold. The live flow does either: `SHOOT_BASE=https://unison-omega.vercel.app FLOW_SIDE=sell node scripts/flow-live.mjs`.
- **Faucet.** Three grants per IP per day (`FAUCET_PER_IP`), from the relayer's own MON.

## Mainnet

1. In every `fly.toml`, set `DEPLOYMENT = "/app/deployments/monad-mainnet.json"` (written by `contracts/script/Deploy.s.sol`; see `docs/GO_LIVE.md`).
2. In `services/relayer/fly.toml`, set `FAUCET = "0"`. The faucet mints mock tokens and is devnet and testnet only.
3. Point every `RPC_URL` / `RPC_WS_URL` secret at mainnet endpoints, fund the keeper and relayer keys with MON, then redeploy all four apps.

`CLEAR_GAS` defaults to a fixed limit (`8000000`). `CLEAR_GAS=auto` sends the clear's `eth_estimateGas` × 1.2 instead, and Monad charges the limit, so it is usually much cheaper. On anvil it sized every e2e clear at 1.22–1.41× the gas used and each job finished in one call (0.46M–2.9M against 8M).

A clear pauses itself once gas runs below its reserve, so an estimator can always "succeed" by pausing again at once. On the devnet that happened: a paused job was continued with 77k-gas calls that made no progress, indefinitely. Auto mode therefore estimates only an opening clear (clamped to `MIN_CLEAR_GAS`, default 2M, and `MAX_CLEAR_GAS`, default 25M), and gives a continuation, or the attempt after a failed clear, the full `MAX_CLEAR_GAS`. That budget must cover the auction's one non-yielding step (building the batch's curve), which grows with the number of non-empty book shards and buckets in the band. Keep it at or under the network's per-transaction gas limit, and watch for `clear.continue` lines in the keeper log.

## Local stack

`node scripts/dev-stack.mjs` boots everything on one machine and writes `NEXT_PUBLIC_*` settings for `apps/web`:

- anvil :8545, then the DevNet deploy;
- relay :8787, keeper, relayer :8788 (faucet on) and tape :8790.

Run `node scripts/dev-stack.mjs --chain-only` before `pnpm --filter @unison/keeper e2e`, since the e2e starts its own relay, relayer and tape.
