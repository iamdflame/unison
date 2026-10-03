# Go-live runbook (Monad mainnet)

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
