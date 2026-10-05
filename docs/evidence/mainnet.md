# Unison on Monad mainnet (beta)

Launched on **5 October 2026**, on chain 143, with real assets.

- **Markets:** aNVDA/AUSD and WMON/AUSD.
- **Prices:** Chainlink feeds read as each batch clears. No Unison key signs a mainnet price.
- **Config:** [`deploy/monad-mainnet-beta.json`](../../deploy/monad-mainnet-beta.json).
- **Record:** [`deployments/monad-mainnet.json`](../../deployments/monad-mainnet.json).
- **Runbook:** [`docs/GO_LIVE.md`](../GO_LIVE.md).

Every row below can be checked on the explorer: https://monadvision.com.

## Contracts

| | Address |
|---|---|
| UnisonExchange (proxy) | `0x1696170d40E703F1378989383c21Ec96ED1Adf75` |
| OrderGateway (passkeys, gasless) | `0xfB246Ac236872534305d7d058B22AdB7Cb58033A` |
| ChainlinkReference | `0xf5B4dcd734038f104Ef2Fd3F150418dDd38f0578` |
| IssuerDenylistEligibility (mirrors Anchored's denylist) | `0xB5191aca4CA04beDbE744E96F984302e6d8987b8` |
| aNVDA/AUSD vault (market 0) | `0x76d9FeAb2d1DD7e689eA253503b848633792f8Db` |
| WMON/AUSD vault (market 1) | `0x92f15839efcD72E6C9236ca63F1de4ee159CeeF3` |
| OperatorSignedReference | `0x2673fBF6Fd9E66ab564AD1B31689DD712E59e746`. Deployed, but **no signer is registered** and no market uses it. |

## Price sources (Chainlink on Monad)

| Market | Feed | Hours |
|---|---|---|
| aNVDA/AUSD | wNVDAx-USD `0x03ffa4673c060339E6a8E5Ba1a12B3301c966bf0` over AUSD/USD `0xE20751C7B5867bCBef815ffc1b284c3f412a9e13` | 24/5: Sun 20:00 → Fri 20:00 New York. Outside these hours the market runs DISCOVERY call auctions. |
| WMON/AUSD | MON/USD `0xBcD78f76005B7515837af6b50c7C52BCf73822fb` over AUSD/USD | Always open |

wNVDAx-USD is Chainlink's "Calculated" tokenized-equity feed: NVDA times the xStock's share multiplier, which is about 1. At launch it read $239.97.

## Accounts

| Role | Address |
|---|---|
| Deployer, admin (for now), team trading account | `0x55DF8EA97d41b7F487c6Dcc077dFd0B487E3557D` |
| Guardian (pause, halt) | `0x0562b2b0914b3Bb082A623657729452fc9bf26E4` |
| Keeper (clears) | `0xCA2B2DFF387Aa614eAB645B0Ba7863cCFA5a274e` |
| Relayer (gasless passkey actions) | `0xf46f4f9Da2Ba1c627632d5D465377cfCDFa3A241` |

The tape counts these accounts, and the vaults, apart from outside traders: `GET /v1/stats` on https://unison-tape-mainnet-production.up.railway.app.

## Launch, in order

| Step | Transaction |
|---|---|
| Deploy: 26 transactions, about 27.7M gas, about 3.1 MON (≈ $0.10). The first and last are listed here. | `0x1b36f273bd46c7a5cd5a265d2137a8a66daa8be727ffcdf49821fa52ae952def` … |
| Vault seed: approve 40 AUSD | `0xd711ec06e90558b446a9c23de970b15fa34918ce827a82874ca6283253490f63` |
| Vault seed: `requestDeposit(40 AUSD)` | `0xac6375c34d623afd99866817bda6322a42d0ab74c4f611d060e6a0bf3b318799` |
| Keeper: first clear, on the Chainlink reference | `0xa91296890409d15a0ba69f3bcdfedb9826aee0cd1984f97a1af21bed46856e4c` |
| Keeper: vault `process()`, crediting the 40 AUSD | `0x11cced4816c76e28c6ec79e12a2c5c8ebb690cbdf8e683170e7823a45b788fd8` |
| Team: deposit 0.0348 aNVDA (bought on a Monad DEX at $287.69, through KyberSwap) | `0xe1dbad48e9ab8d3bd7529d4cfa3fba783362626efc1af05219eac865f2d7323b` |
| Team: sell it into the vault's bid | `0x59137f6a59b4ae954edb51c1efc44ecbf2806e01baea00d85e0f43db1b53613a` |

## First prints (aNVDA/AUSD)

The team's sale filled against the vault across several auctions, each at one price just under the reference: the vault's 10 bp spread, with the price rounded to the tick.

| Block | Price | Reference | vs reference | Volume (aNVDA) | Clear tx |
|---|---|---|---|---|---|
| 110,850,862 | $239.76 | $239.967 | −8.6 bp | 0.006668 | `0x37473d90535061ea0f4b7244d09de79259867a96d01c13e9847a2723dfb62088` |
| 110,850,869 | $239.75 | $239.967 | −9.1 bp | 0.006668 | `0xdd861c3080d0ff700713144b40b8fc100a565b0612e6becee4e337f4e620c9b8` |
| 110,850,882 | $239.81 | $239.967 | −6.6 bp | 0.001419 | `0xf0e8e0504d8f9965c0cb3c3e7708b2f403a62026de5f0cdbf73921e006c8fc16` |

Every print links into the venue's receipt chain (`chainOk: true` on the tape).

## What is still to come

- **Outside traders.** The proof that matters is fills by accounts that aren't ours. Their certificates and transactions will be added here as they happen, with `GET /v1/stats` as the running count.
- **The first live weekend (Fri Oct 9 → Sun Oct 11).** aNVDA trades in DISCOVERY call auctions while its feed is closed, then reopens on the first Chainlink update. It will be written up in `weekend-2026-10-09.md`.
- **Admin handover.** The admin role moves from the deployer key to the team's own wallet.
