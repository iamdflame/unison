# Go-live runbook (Monad mainnet)

## The mainnet beta (`deploy/monad-mainnet-beta.json`)

**Launched 5 October 2026.** Addresses, transactions and the first prints are in [evidence/mainnet.md](evidence/mainnet.md).
- The admin is still the deployer key; its handover to the team's wallet (step 3) is pending.
- The services run on Railway: `unison-keeper-mainnet`, `unison-relayer-mainnet` and `unison-tape-mainnet` ([DEPLOY](DEPLOY.md)).
- Every contract is verified on Sourcify.
- `apps/web/scripts/ops/` holds the funding and launch scripts that ran it (`mainnet-fund.mjs`, `mainnet-launch.mjs`).

**What it lists:**
- aNVDA/AUSD and WMON/AUSD, with real assets.
- Prices are Chainlink feeds read as each batch clears: wNVDAx-USD (24/5) over AUSD/USD, and MON/USD. No relay signs anything, so `relaySigners` is empty.
- Small vaults, a daily cap per market, and Anchored's `COMPLIANCE()` denylist mirrored at every aNVDA deposit and withdrawal.

**Rehearsed on a fork.** The whole beta was rehearsed end to end on an anvil fork of Monad mainnet (`deploy/monad-fork-beta.json` → `deployments/monad-fork-beta.json`):
- deploy and the role handover;
- seeding;
- keeper clears on the Chainlink reference;
- the team's sale into the vault's bid;
- a passkey account funded from a browser wallet;
- a 0.01-share buy and its certificate.

Run it again with `REHEARSAL=1 FORK_RPC=http://127.0.0.1:8547 node apps/web/scripts/flow-mainnet.mjs` against a fork stack.

| Step | Command or action |
|---|---|
| 0. Keys | `.secrets/mainnet.env` (gitignored) holds the deployer, keeper, relayer and guardian keys. Fund the deployer ~5 MON, keeper ~100 MON, relayer ~40 MON, guardian ~1 MON. |
| 1. Roles | Put the admin wallet in `admin` and `GUARDIAN_ADDRESS` in `guardian`. |
| 2. Deploy | `cd contracts && DEPLOYER_PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY DEPLOY_CONFIG=../deploy/monad-mainnet-beta.json forge script script/Deploy.s.sol --rpc-url https://rpc.monad.xyz --broadcast --slow --verify --verifier sourcify` → `deployments/monad-mainnet.json` (about 28M gas, about 3 MON at 100 gwei) |
| 3. Accept | From the admin wallet: `acceptOwnership()` on `chainlinkReference` and on `eligibility` (both Ownable2Step). Only when `admin` differs from the deployer. |
| 3b. Verify | `forge verify-contract <address> <path>:<Name> --chain 143 --verifier sourcify` for each contract in the broadcast; wallets then decode `approve` and `depositFor` |
| 4. Seed | LP: `approve(vault, 40e6)` then `vault.requestDeposit(40e6)` on the aNVDA vault; the keeper clears and calls `process()` |
| 5. Inventory | The team sells 0.10 aNVDA (bought on Monday Trade) into the vault's bid, so the vault can offer as well as bid |
| 6. Services | Railway: `keeper-mainnet`, `relayer-mainnet` (`FAUCET=0`) and `tape-mainnet` (`TEAM_ACCOUNTS` = the team's trading accounts) with `DEPLOYMENT=deployments/monad-mainnet.json`. There is no relay on mainnet. |
| 7. Web | Vercel: `NEXT_PUBLIC_MAINNET_TAPE_URL`, `NEXT_PUBLIC_MAINNET_RELAYER_URL` and optionally `NEXT_PUBLIC_MAINNET_RPC_URL`. The venue switch then offers mainnet, and `?network=mainnet` links to it. Add the new services' URLs to `CORS_ORIGINS`. |

**Daylight saving:** the aNVDA session window `[0, 432000]` is Sun 20:00 → Fri 20:00 New York time under EDT. Retune it to `[3600, 435600]` when US daylight time ends on Nov 1 (`setFeed` from the admin).

## The causal cutover (`deploy/monad-mainnet-causal.json`)

The cutover moves mainnet's markets to [SPEC §7.4](SPEC.md). After it, each auction prices at the first Chainlink observation made after its orders were sealed, and a waiting order is sealed. It also opens [the standing challenge](evidence/challenge.md) and puts every admin power behind a public timelock.

**Rehearsals.** Every step below has run through `mainnet-launch.mjs` on anvil forks of Monad mainnet, with `DEPLOYMENT_RECORD=deployments/<fork>.json` so the real record is never touched:
- **The full dress rehearsal**, at block 110,940,150: every step below, in order, through to the timelock.
- **The live stack**, on a fork with the upgrade applied in place. A passkey order was sealed, priced at a new observation, cleared by the keeper and claimed, and the tape marked it causal. The bot fired on both markets and settled.
- **The timelock**: an early execution was refused; after 48 h a stranger executed the scheduled batch, and the delay became 7 days.
- **The upgrade step again**, at block 110,951,388, with the ±50 bp band for WMON and its control.

**Before it can run:**
- No order may rest or wait on a market that switches; `UpgradeCausal.s.sol` checks this first. Resting orders belong to their owners, and only the owner can cancel them.
- The deployer needs about 10 MON of gas for the cutover. Everything it funds is listed in the table below.

| Step | Command (`node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs …`) | Check |
|---|---|---|
| 1. Status | `status` | no resting or waiting orders; balances |
| 2. Upgrade | `upgrade-causal`: the v2 implementation, `ChainlinkCausalReference`, `setCausal` on aNVDA and WMON, WMON's band to ±50 bp, the vaults' `closedMult` to 255, and the old-rule control market and its vault | `causalOf(0)`, `causalOf(1)` = `(true, 2)`; `market(1).bandBps` = 50; the record names `causalReference` and the control |
| 3. Verify | `forge verify-contract … --chain 143 --verifier sourcify` for the implementation, the adapter and the control vault | Sourcify "full match" |
| 4. Services | Redeploy `keeper-mainnet` and `tape-mainnet` so they read the new record (both already speak the causal rule) | keeper log `clear.open` with `"causal":true`; tape prints with `"rule":"causal"` |
| 5. AUSD | `node --conditions=development scripts/ops/mainnet-fund.mjs mon-ausd …` | the deployer's AUSD |
| 6. Vaults | `seed-vault wmon <AUSD>`, `seed-vault control <AUSD>`; once each first deposit has settled, `stock-wmon wmon <WMON>` and `stock-wmon control <WMON>` | each vault quotes both sides |
| 7. Challenge | `challenge-deploy`, then `pot unison <AUSD>` and `pot control 1` | `/challenge` shows both pots |
| 8. Bot | `bot-key` once, then `bot-fund <MON> <WMON> <AUSD>`. Deploy `unison-adversary-mainnet` (`SERVICE=adversary`; settings in [DEPLOY](DEPLOY.md)) and set `NEXT_PUBLIC_MAINNET_ADVERSARY_URL` on Vercel | `GET /v1/score` answers; the first `fire` in its log |
| 9. Site | Push the record and merge the `causal-cutover` branch (the site's words for the new rule) | `/receipt/mainnet/1/<upTo>` shows sealed → observed → cleared |
| 10. First prints | A labelled team trade on each causal market | `node apps/web/scripts/verify-receipt.mjs <tx>`: every check passes |
| 11. Evidence | Transactions and first receipts in [evidence/mainnet.md](evidence/mainnet.md) | — |
| 12. Timelock | `timelock <owner wallet>`, after the last change the team still needs to make directly | after it, the deployer holds no role, and the scheduled batch is executable by anyone 48 h later |

**After the timelock,** every change to prices, markets or roles waits in public: 48 h at first, then 7 days. Plan around that:
- **Daylight saving.** aNVDA's session window `[0, 432000]` must become `[3600, 435600]` when US daylight time ends on 1 November. Under a 7-day delay, schedule `setFeed` by 25 October.
- **What the guardian keeps.** It can still pause, halt and set daily caps, at once. None of these can move a balance or set a price.

## The full deploy (`deploy/monad-mainnet.json`)

Everything below has been rehearsed on an anvil fork of Monad mainnet (`deploy/monad-fork.json`). Going live needs only keys, funds and the commands below.

## 0. What the operator provides

| Item | Purpose | Notes |
|---|---|---|
| **Deployer key** + ~10 MON | Deploys and configures everything | The full 10-market deploy is ≈52M gas, a few MON at 100 gwei |
| **Admin** (multisig) and **guardian** addresses | Roles are handed over after deploy | Leave them as `0x0` to keep roles on the deployer for the first hours |
| **Relay key(s)** | Sign references | Put their addresses in `relaySigners`. Use P-256 HSM keys in production. |
| **Keeper key** + ~20 MON | Runs clear jobs | Only pays for clears that trade, merge stale orders or serve vault queues |
| **Relayer key** + ~5 MON | Gasless order relaying | Optional |
| **AUSD** for vault seeding | Liquidity from block one | For example 5–50k AUSD per launch market |
| **Market data** | Equity references | Alpaca key (IEX, dev/demo) or a licensed feed |

## 1. Deploy

```bash
cd contracts
# fill relaySigners (and admin/guardian if handing off) in deploy/monad-mainnet.json first
DEPLOYER_PRIVATE_KEY=0x… DEPLOY_CONFIG=../deploy/monad-mainnet.json \
  forge script script/Deploy.s.sol --rpc-url https://rpc.monad.xyz --broadcast --slow \
  --verify --verifier sourcify
# → deployments/monad-mainnet.json (addresses + market ids)
```

## 2. Seed the vaults

Run this once per launch market, in the order request → first clear → process:

```bash
cast send $AUSD "approve(address,uint256)" $VAULT 50000000000 --private-key $LP --rpc-url https://rpc.monad.xyz
cast send $VAULT "requestDeposit(uint256)" 50000000000 --private-key $LP --rpc-url https://rpc.monad.xyz
# the keeper clears with a reference published after the request, then calls process()
```

## 3. Run the services

```bash
# reference relay (equities; FX/MON markets use Chainlink and need no relay)
DEPLOYMENT=../../deployments/monad-mainnet.json RPC_URL=https://rpc.monad.xyz \
RELAY_PRIVATE_KEY=0x… PROVIDER=alpaca ALPACA_KEY_ID=… ALPACA_SECRET_KEY=… SESSION=us-equity \
  pnpm --filter @unison/relay start

# keeper (clears every market; cost-aware)
DEPLOYMENT=../../deployments/monad-mainnet.json RPC_URL=https://rpc.monad.xyz \
KEEPER_PRIVATE_KEY=0x… RELAY_URL=http://127.0.0.1:8787 CLEAR_GAS=8000000 \
  pnpm --filter @unison/keeper start

# gasless relayer (optional)
DEPLOYMENT=../../deployments/monad-mainnet.json RELAYER_PRIVATE_KEY=0x… pnpm --filter @unison/relayer start
```

The public RPC rate-limits and caps `eth_getLogs` at a 100-block range. For sustained operation, use a dedicated endpoint (QuickNode, Dwellir, Chainstack).

## 4. First live weekend (evidence)

| When (UTC) | What happens | Captured |
|---|---|---|
| Fri Oct 9 20:00 → | US equities go CLOSED, so DISCOVERY call auctions run every `discCadence` blocks, with bands widening by √t | Every print (`BatchCleared`), the band and the regime |
| Fri Oct 9 22:00 → Sun Oct 11 22:00 | **GBPm/AUSD** goes CLOSED with the FX weekend. This market is real, permissionless and Chainlink-referenced. | Weekend implied GBP price vs the Sunday open |
| Sun 22:00 | FX reopens, with a REOPENING band on the first auction | Opening-cross error vs Chainlink |
| Mon Oct 12 13:30 | Nasdaq opens and the equities' REOPENING cross runs | Last DISCOVERY print vs the official open (bp) |

Publish the results to `docs/evidence/weekend-2026-10-09.md`, with transaction links.

## 5. Safety switches

| Switch | Command |
|---|---|
| Pause everything (guardian) | `cast send $EXCHANGE "pause()"` |
| Halt one market (guardian / CRE) | `cast send $EXCHANGE "setHalt(uint256,bool)" $MKT true` |
| Daily volume cap (`CAP_ROLE`) | `cast send $EXCHANGE "setDailyCap(uint256,uint128)" $MKT <baseUnits>` |
| Pause a vault's quoting (risk) | `LiquidityVault.setParams({... paused: true})` |
