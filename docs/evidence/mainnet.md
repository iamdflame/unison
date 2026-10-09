# Unison on Monad mainnet (beta)

Launched on **5 October 2026**, on chain 143, with real assets. **Moved to the causal rule on 6 October 2026** ([below](#the-causal-cutover-6-october-2026)).

- **Markets:** aNVDA/AUSD and WMON/AUSD, plus WMON/AUSD (old rule), a control kept on the rule the cutover replaced.
- **Prices:** each auction prices at the first Chainlink observation made after its orders were sealed ([SPEC §7.4](../SPEC.md), [evidence](causal.md)). No Unison key signs a mainnet price.
- **Config:** [`deploy/monad-mainnet-beta.json`](../../deploy/monad-mainnet-beta.json).
- **Record:** [`deployments/monad-mainnet.json`](../../deployments/monad-mainnet.json).
- **Runbook:** [`docs/GO_LIVE.md`](../GO_LIVE.md).

Every row below can be checked on the explorer: https://monadvision.com.

## Verification

Every contract is verified on Sourcify:
- **At launch:** the exchange implementation `0x9a5037e5977e28e60d15c8082e9145331b2ab8b7`, its proxy, the gateway, both reference adapters, the denylist mirror and both vaults.
- **At the cutover:** the v2 implementation, the causal adapter, the control's vault and both challenge contracts.

Sourcify reports a `match`: the deployed bytecode is the one the sources compile to. It cannot report an exact match, because the build embeds no metadata hash (`bytecode_hash = "none"`, `cbor_metadata = false` in `contracts/foundry.toml`). Explorers and wallets decode calls from the verified sources.

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
| UnisonExchange v2 implementation (causal) | `0xBcE55ebB12E017a2A1a484375Fa006E32Fb656eF` |
| ChainlinkCausalReference (markets 0 and 1) | `0xB161400dDfC592fD66b57dDaE46966ED74Ce891d` |
| WMON/AUSD (old rule) vault (market 2, the control) | `0x15F7d52593ac7F6840E7d9d74e718e772E194dCb` |
| LatencyChallenge on Unison (market 1) | `0xDcD3E86518db6A40C4feBa576efff598cA3B90d1` |
| LatencyChallenge on the control (market 2) | `0x5Ce9D9f491E2d16c94F56eD09BEa23e7109976e9` |

The launch-time `ChainlinkReference` now prices only the control.

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
| The house adversary (our sniper in the challenge; counted as the team's) | `0xcEc80166Ab48cb3C4ebD98671524761b1fd81276`, trading through `0xB1964fD4521977d71FE058A8b96140faddB611b6` (Unison) and `0xAc888Ed66Ba7599D89C59886E947A346D5a054f6` (control) |
| The project owner's passkey account (its fills count as the team's) | `0x13250c2de5ce381432f4f1c77249af6789d62da7` |

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

## The causal cutover (6 October 2026)

Run through `apps/web/scripts/ops/mainnet-launch.mjs`, step by step as rehearsed on forks ([runbook](../GO_LIVE.md#the-causal-cutover-deploymonad-mainnet-causaljson)). Beforehand, every resting order was cancelled by its owner, and nothing was waiting.

| Step | Transaction |
|---|---|
| Upgrade: 16 transactions, 19.7M gas, 2.01 MON (≈ $0.06). It deployed v2 and `upgradeToAndCall`, then the causal adapter and its two feeds, `setCausal` on markets 0 and 1, WMON's band to ±50 bp, both vaults' closed multiplier to 255, and the control market and its vault. The first and last are listed here. | `0xf6b14434bcf7ed0a2bb612dfbc243b52ffda9ff3c2577a72716fe8b177094e1d` … `0x6248800b7ba68375df22b29c1db63cc7cb9d8b54417bc2074d2eef145e700342` |
| Swap 1,150 MON → 33.47 AUSD ($0.02910 per MON, through KyberSwap) | `0x60adf03767fd72d91832a3c8a1c957081824d1bba716273abf5fb123769120b0` |
| WMON vault: `requestDeposit(14 AUSD)` | `0x291790f25c91fb2027a34a204a0698363a37448c61b90dbdcdd3716d601cb608` |
| Control vault: `requestDeposit(2 AUSD)` | `0x2c26d916bf9896039f8eb5d2e798d08babad91437308f57c30201e81f7a00f94` |
| Keeper: the first causal clear (vault queue only), then `process()` | `0x3cf53b752a41660cb00e7ce6b60506bf99d76be4d16d1a41e73eedfc97d739a5`, `0xb9a03cbc341c324f289def625034c711f78eec9bd0c3c89bfbd2cf5b3e1edd93` |
| Challenge contracts (2 transactions, 0.60 MON) | `0x7d4dfef90f6f5c5ad7e34cc1bfc4834b9b99e181195a3da38dc6d0451993ac52`, `0x5effd53feca7d3982f9d01b3e5b137e0bf75573803a991bc6ae9708083f96767` |
| Pots: 18 AUSD on Unison, 1 AUSD on the control | `0xf8fdf511070cbe142a9703983139f2c1d3a92f9f51ede41e253cc6dfd5aad3ce`, `0x4f88bf1493fe35e4eb2efc20214786685ace56ed73f2d99f61df2a2365d1cd45` |
| Inventory: 250 WMON to the WMON vault, 60 WMON to the control's | `0x686bf889a5ba858c22f1b19da2a3e922a22ba24e08794edc8678d5473aa474dc`, `0x17c3075cee30490d6244d75816e795f0754a100247edd6207bf2b11beaefe12d` |
| The house adversary: funded, its two challenge accounts opened (45 WMON and 1.25 AUSD each) | `0x54fad385f934df566271c5b811840dd265c10e1a2f5a4df8b96af92513317f33`, `0xa78ed6c333c906b1485122fdfab0eea6c36839c58f02966fd3bde0bd5abae7ab`, `0xc67b40c7cd49d5e471ccf8b736faa8e24bb06385cde0aeee08a4b285e1836c01` |
| Team: sell 3 WMON into the WMON vault's bid, one auction | `0x4e083bd1b8d0a814dff52e36f54f33c87f680fa67763068bdd114d2784e7abbf` |

## The first causal print (WMON/AUSD)

The team's 3 WMON and the adversary's first trade, 3 WMON sold on a move it saw on Coinbase, met in one auction and filled against the vault's bid.

| | |
|---|---|
| Batches | up to block 111,055,816, sealed at 1791295076 (13:57:56 UTC) |
| Chainlink round | `18446744073710159930` on MON/USD: observed at 1791295082, 6 s after the seal; landed at 1791295095 |
| The round before it | observed at 1791295052, before the seal: no earlier observation qualified |
| Price, reference | $0.028942, against $0.028994 (−17.9 bp: the vault's 20 bp bid, rounded to the tick) |
| Volume | 6 WMON |
| Clear tx | `0x128b8b18f4ae90cf0f79f439f5886f2f3ff548f2ebb3dcd7a847c2284351596e` (block 111,055,885) |
| Tape | `rule: "causal"`, `causal: true`, `chainOk: true` |

`node apps/web/scripts/verify-receipt.mjs 0x128b8b18f4ae90cf0f79f439f5886f2f3ff548f2ebb3dcd7a847c2284351596e` checks it from the chain alone. Every check passed:
- the receipt hash recomputes;
- the reference time is Chainlink's observation time;
- the observation came before the report landed;
- the observation came 6 s after the seal;
- the round before it did not come after the seal.

The receipt page shows the three times in order: https://www.unisonfi.com/receipt/mainnet/1/111055816.

The adversary's matching sale on the old-rule control filled four seconds earlier, at $0.029059 (tx `0xa16a661d3d200629a1bf09de7348f1cf4702dec8302a680a90445cc85a33b180`). That price came off the round already on chain, $0.02912, observed before the move. For the same 3 WMON, the old rule paid the sniper 40 bp more than Unison did. That gap is what the challenge measures.

## What is still to come

- **Outside traders.** The proof that matters is fills by accounts that aren't ours. Their certificates and transactions will be added here as they happen, with `GET /v1/stats` as the running count.
- **The first live weekend (Fri Oct 9 → Sun Oct 11).** aNVDA trades in DISCOVERY call auctions while its feed is closed, then reopens on the first Chainlink update. It will be written up in `weekend-2026-10-09.md`.
- **Admin handover.** Not done yet. The plan, reworked on 9 October: first one exchange upgrade (pausing, halting or deactivating a market returns every waiting order without an oracle; the gateway role is locked), then a 7-day timelock from the first day, proposed by a Safe with outside signers and cancellable by a guardian Safe, taking every role and every adapter's ownership in one run ([roadmap](../ROADMAP.md), [threat model](../THREAT_MODEL.md#what-the-admin-can-do)).
