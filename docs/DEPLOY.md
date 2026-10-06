# Deploying Unison

The live setup runs the web app on **Vercel** and the services on **Railway**, both driven from their CLIs. It serves two networks from one site. A Fly.io recipe for the same services is kept at the end, as an alternative.

## What runs where

| Piece | Where | Network | Address |
|---|---|---|---|
| Web app (`apps/web`) | Vercel project `unison` | both: the venue switch picks one | https://www.unisonfi.com (the apex redirects to www); also https://unison-omega.vercel.app |
| `unison-relay` | Railway, internal only | testnet | `http://unison-relay.railway.internal:8787` |
| `unison-keeper` | Railway, a worker | testnet | — |
| `unison-relayer` | Railway, `/data` volume | testnet | https://unison-relayer-production.up.railway.app |
| `unison-tape` | Railway, `/data` volume | testnet | https://unison-tape-production.up.railway.app |
| `unison-keeper-mainnet` | Railway, a worker | mainnet | — |
| `unison-relayer-mainnet` | Railway, `/data` volume | mainnet | https://unison-relayer-mainnet-production.up.railway.app |
| `unison-tape-mainnet` | Railway, `/data` volume | mainnet | https://unison-tape-mainnet-production.up.railway.app |

Mainnet runs **no relay**: every mainnet market reads a Chainlink feed, so nothing there signs prices. Run exactly one instance of each service:
- the relayer manages one account's nonces in memory;
- a duplicated keeper races itself;
- the tape's database lives on its volume.

The contracts are on Monad testnet (`deployments/monad-testnet.json`) and Monad mainnet (`deployments/monad-mainnet.json`). Going live on mainnet is in [GO_LIVE.md](GO_LIVE.md); what was deployed is in [evidence/mainnet.md](evidence/mainnet.md).

## Web (Vercel)

**Project settings.** Project `unison`; root directory `apps/web`; Node 24; install `pnpm install --frozen-lockfile`; build `pnpm build`. Deploy from the repository root with `vercel deploy --prod`. `.vercelignore` keeps env files, keys and local folders out of the upload.

**Production environment:**

| Variable | Value | Why |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://www.unisonfi.com` | absolute URLs in the sitemap and share images |
| `NEXT_PUBLIC_NETWORK`, `NEXT_PUBLIC_CHAIN_ID` | `testnet`, `10143` | the default network (free test funds, a lively book) |
| `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_TAPE_URL`, `NEXT_PUBLIC_RELAYER_URL` | the testnet's | the default network's services |
| `NEXT_PUBLIC_MAINNET_TAPE_URL`, `NEXT_PUBLIC_MAINNET_RELAYER_URL`, `NEXT_PUBLIC_MAINNET_RPC_URL` | the mainnet services, `https://rpc.monad.xyz` | the second network the venue switch offers |
| `NEXT_PUBLIC_PASSKEY_RP_ID` | `www.unisonfi.com` | the domain every new passkey belongs to |
| `NEXT_PUBLIC_PASSKEY_LEGACY_RP_IDS` | `unison-omega.vercel.app` | passkeys made there before the domain moved, still offered at sign-in |

**Behaviour that follows from this setup:**
- **No environment:** with none of these set, the app runs as the labelled browser simulation.
- **CSP:** the Content-Security-Policy is built from these variables at build time (`lib/security/csp.ts`). A change needs a redeploy, and locally a dev-server restart.
- **Passkeys across domains:** `apps/web/public/.well-known/webauthn` lists the site's origins, so a passkey made for one domain works on the others (WebAuthn Related Origin Requests). Browsers without that support make the passkey for their own host instead.
- **Commit author check:** the team is on Vercel Pro, which blocks a deploy (`TEAM_ACCESS_REQUIRED`) unless the git commit's author email is verified on a team member's Vercel account.

## Services (Railway)

**Common setup:**
- Project `unison`, one service per process.
- Every service builds `ops/docker/railway.Dockerfile` through `RAILWAY_DOCKERFILE_PATH`, with `SERVICE` (`relay`, `keeper`, `relayer`, `tape`) selecting the process. This is the Fly recipe without BuildKit cache mounts, which Railway rejects.
- Each service's variables are documented at the top of its `src/main.ts`.

| Variable | Testnet | Mainnet |
|---|---|---|
| `DEPLOYMENT` | `/app/deployments/monad-testnet.json` | `/app/deployments/monad-mainnet.json` |
| keeper `RPC_URL` | `https://rpc.ankr.com/monad_testnet` | `https://rpc.ankr.com/monad_mainnet` |
| relayer and tape `RPC_URL` | `https://testnet-rpc.monad.xyz` | `https://rpc.monad.xyz` |
| keeper `RELAY_URL` | `http://unison-relay.railway.internal:8787` | unset (no operator markets) |
| keeper `CLEAR_GAS`, `MIN_CLEAR_GAS`, `MAX_CLEAR_GAS`, `POLL_MS` | `auto`, `2000000`, `25000000`, `2000` | the same |
| relayer `FAUCET` | `1` | `0` |
| relayer `JOBS_DB`, tape `DB_PATH` | `/data/relayer.db`, `/data/tape-v2.db` | `/data/relayer.db`, `/data/tape.db` |
| tape `TEAM_ACCOUNTS` | — | the operator keys and the team's trading accounts, counted apart in `GET /v1/stats` |
| `CORS_ORIGINS` (relayer, tape) | `https://www.unisonfi.com,https://unisonfi.com,https://unison-omega.vercel.app` | the same |
| `TRUST_PROXY` | `1` | `1` |
| Secrets | `RELAY_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY` | `KEEPER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY` |

**Create a service:**

```bash
railway add --service unison-tape-mainnet                  # also links the directory to it: pass --service from now on
railway variables --service unison-tape-mainnet --skip-deploys --set "SERVICE=tape" --set "RAILWAY_DOCKERFILE_PATH=ops/docker/railway.Dockerfile" …
railway volume --service <service ID> add --mount-path /data
railway domain --service unison-tape-mainnet
railway up --service unison-tape-mainnet --detach         # from the repository root
```

**From Git Bash:** prefix calls that pass paths with `MSYS_NO_PATHCONV=1`, or `/data` becomes a Windows path. `railway volume --service` takes the service **ID**, not its name.

Keys live only in `.secrets/testnet.env` and `.secrets/mainnet.env` (git-, Vercel- and Railway-ignored) and in each platform's variable store.

## Order of the first deploy

1. **Contracts.**
   - **Testnet:** `forge script script/Testnet.s.sol --rpc-url monad_testnet --broadcast --slow`, with `DEPLOYER_PRIVATE_KEY`, `KEEPER`, `RELAY_SIGNER`, `RELAYER` and `GAS_TOPUP_WEI` set.
   - **Mainnet:** the runbook in [GO_LIVE.md](GO_LIVE.md).
   - Both write `deployments/<network>.json` with its `startBlock`. Commit it; addresses are public.
2. **Services.** `railway up --service <name>` for each service, from the repository root.
3. **Web.** Set the web app's variables to the Railway URLs and redeploy it.

## What the first testnet run taught

- **Gas.**
  - Monad charges the gas limit. The testnet lists three markets (`MARKETS=3`, about 3.2 MON to deploy).
  - The keeper runs with `CLEAR_GAS=auto` (estimate × 1.2, floor 2M). It only clears an auction that trades, merges stale orders, or gives a waiting vault queue its first post-request reference.
  - A vault request that already has a reference is processed without a clear.
- **RPC limits.** The public endpoint allows 15 requests a second per IP, and Railway's services share egress. thirdweb's endpoint answered slowly and once hung for 20 minutes, stalling the tape's start.
- **First trade.**
  - Fresh vaults hold only AUSD, so the first fill is a sale into their bid; buys fill once someone has sold.
  - The live flow does either: `SHOOT_BASE=https://www.unisonfi.com FLOW_SIDE=sell node scripts/flow-live.mjs`.
- **Faucet.** Three grants per IP per day (`FAUCET_PER_IP`), from the relayer's own MON.

## What the first mainnet run taught

- **Estimate gas on Monad.**
  - Swap aggregators (KyberSwap) estimate gas by Ethereum's schedule, and a swap at that limit ran out of gas.
  - Monad prices cold state differently and charges the limit, so `apps/web/scripts/ops/` asks Monad's own `eth_estimateGas` and adds 25%.
- **Forge needs a consistent RPC.** A load-balanced endpoint answered "block requested not found" for the block a `forge script` had just read. Deploy against `https://rpc.monad.xyz`.
- **Real stock is thin on DEXes.** On 5 October, $10 of aNVDA cost $287.69 a share against a $239.97 reference. Buy inventory in small amounts; the launch script caps the price.
- **Push feeds move between prints.** The tape knows a Chainlink market's price only from its last trade. The web app reads the adapter itself (`LightReader.reference`), so the band, the vault's quote and the ticket match the next auction.
- **Passkeys belong to a domain.** A passkey made on the vercel.app alias was invisible on www.unisonfi.com until the related-origins file and the `PASSKEY_*` variables above.

## Clear gas (`CLEAR_GAS`)

- **The modes.** `CLEAR_GAS` defaults to a fixed limit (`8000000`). `CLEAR_GAS=auto` sends the clear's `eth_estimateGas` × 1.2 instead. Monad charges the limit, so auto is usually much cheaper. On anvil it sized every e2e clear at 1.22–1.41× the gas used, and each job finished in one call (0.46M–2.9M against 8M).
- **Why auto estimates only an opening clear.**
  - A clear pauses itself once gas runs below its reserve, so an estimator can always "succeed" by pausing again at once. On the devnet that happened: a paused job was continued with 77k-gas calls that made no progress, indefinitely.
  - Auto mode therefore estimates only an opening clear, clamped between `MIN_CLEAR_GAS` (default 2M) and `MAX_CLEAR_GAS` (default 25M).
  - A continuation, or the attempt after a failed clear, gets the full `MAX_CLEAR_GAS`.
- **Sizing `MAX_CLEAR_GAS`.** It must cover the auction's one non-yielding step, building the batch's curve, which grows with the number of non-empty book shards and buckets in the band. Keep it at or under the network's per-transaction gas limit, and watch for `clear.continue` lines in the keeper log.

## Local stack

`node scripts/dev-stack.mjs` boots everything on one machine and writes `NEXT_PUBLIC_*` settings for `apps/web`:
- anvil :8545, then the DevNet deploy;
- relay :8787, keeper, relayer :8788 (faucet on) and tape :8790.

Restart `next dev` after the stack rewrites `apps/web/.env.local`, because the CSP is built at startup. Run `node scripts/dev-stack.mjs --chain-only` before `pnpm --filter @unison/keeper e2e`, since the e2e starts its own relay, relayer and tape.

## Alternative: Fly.io

The same services also deploy to Fly, one app each, from `ops/docker/service.Dockerfile` (one `SERVICE` build argument per app):

| App | Exposure | State |
|---|---|---|
| `unison-relay` | **internal only**: `http://unison-relay.internal:8787` | none |
| `unison-keeper` | none (a worker) | none |
| `unison-relayer` | public HTTPS, `/health` checked | volume `relayer_data` → `/data` |
| `unison-tape` | public HTTPS + SSE, `/health` checked | volume `tape_data` → `/data` |

Every app keeps one machine running (`auto_stop_machines = "off"`, `min_machines_running = 1`). The `fly.toml` files default to Monad testnet. For mainnet, set `DEPLOYMENT = "/app/deployments/monad-mainnet.json"`, set the relayer's `FAUCET = "0"`, and skip the relay.

```bash
fly apps create unison-relay && fly apps create unison-keeper && fly apps create unison-relayer && fly apps create unison-tape
fly volumes create tape_data    --app unison-tape    --region iad --size 10 --yes
fly volumes create relayer_data --app unison-relayer --region iad --size 1  --yes
fly secrets set --app unison-relay --stage RPC_URL=https://… RELAY_PRIVATE_KEY=0x… ALPACA_KEY_ID=… ALPACA_SECRET_KEY=… \
  RELAY_ADMIN_TOKEN="$(openssl rand -hex 32)"
fly secrets set --app unison-keeper  --stage RPC_URL=https://… KEEPER_PRIVATE_KEY=0x…
fly secrets set --app unison-relayer --stage RPC_URL=https://… RELAYER_PRIVATE_KEY=0x…
fly secrets set --app unison-tape    --stage RPC_URL=https://… RPC_WS_URL=wss://…
# the relay first (the keeper and the tape read it), and never with a public IP
fly deploy . --config services/relay/fly.toml   --dockerfile ops/docker/service.Dockerfile --no-public-ips
fly deploy . --config services/keeper/fly.toml  --dockerfile ops/docker/service.Dockerfile --no-public-ips
fly deploy . --config services/relayer/fly.toml --dockerfile ops/docker/service.Dockerfile
fly deploy . --config services/tape/fly.toml    --dockerfile ops/docker/service.Dockerfile
```

**About the image.** It runs each service's TypeScript directly (`node --conditions=development`) and keeps the pnpm workspace layout, because Node won't strip types inside `node_modules`. It runs as the unprivileged `node` user under `tini`, and the entrypoint chowns the mounted volume first.

**Day 2:**

| Task | Command |
|---|---|
| Check health | `curl -s https://unison-tape.fly.dev/health`, `curl -sN "https://unison-tape.fly.dev/v1/stream?topics=heads"` |
| Roll back | `fly releases --app <app> --image`, then `fly deploy --app <app> --config services/<svc>/fly.toml --image <previous image>` |
| Rotate a secret | `fly secrets set --app <app> NAME=value` (restarts the machine) |
| Halt a market's reference (relay) | `POST http://localhost:8787/halt/<market>?on=1` with `authorization: Bearer $RELAY_ADMIN_TOKEN`, from `fly ssh console --app unison-relay` |
| Rebuild the tape index | delete `/data/tape.db*` over `fly ssh console`, then `fly machine restart --app unison-tape` |
