# Why Monad, and how Unison uses it

Unison's design only works on a chain like Monad. Each row below links a Monad property to a concrete design decision and to the evidence for it.

| Monad property | Design decision | Evidence |
|---|---|---|
| **300 ms blocks, 600 ms finality** | One batch auction per block. A trader waits at most about 0.3 s for a uniform-price print. On a 12 s chain, per-block batches would be unusably slow. | `UnisonExchange` pending ring keyed by `block.number`; devnet e2e prints within 1–2 blocks |
| **Optimistic parallel execution** (conflicting slots force re-execution) | No shared hot slot on the order path: each account's balances and orders sit in its own page; books are sharded by `account % S`; pending aggregates are keyed by `(batch, side, shard, ioc, tick)` | `ExchangeLayout`, `BookStore` key `(market, side, shard)` |
| **MIP-8 page-based storage pricing** (cold page 8,100, warm slot 100) | Every hot structure is page-aligned: tick levels (128 ticks per page), hierarchy totals, account pages, pending groups. Scans touch many slots but few pages. | The same clear costs **1.77M gas under Monad rules vs 3.01M under Ethereum's**; 6.1M vs 9.6M at 200 orders ([gas](evidence/gas.md)) |
| **Gas charged on the limit**, not the gas used | Explicit gas limits everywhere (SDK: estimate + 12%). The keeper `eth_call`-simulates a clear and pays only when it trades, merges stale orders or serves a vault queue. The resumable job makes a fixed per-call limit safe. | `services/keeper` policy tests; `ExchangeClearing` `GAS_RESERVE` |
| **128 KB contract size limit** | The exchange is one 36.6 KB contract. That means no proxy-of-proxies or diamond, and no cross-contract hops in the clearing loop. | `forge build --sizes`; `code_size_limit = 131072` |
| **P-256 precompile at `0x0100`** (6,900 gas) | Relays can sign references with HSM or secure-enclave P-256 keys. Passkey accounts trade and withdraw with WebAuthn assertions, with no seed phrase. | `OperatorSignedReference` (P-256 signer), `OrderGateway` + `WebAuthn`; tests sign with `vm.signP256` |
| **No public mempool; leader ordering** | Inside a batch, order of arrival is irrelevant: everyone gets one price. Inclusion games reduce to "make the batch or wait 300 ms". The reference is bound to the batch number, so no one can choose a favourable price. | `Clearing` (order-independent), `clearUpTo` + batch-bound signatures |
| **Real assets already on Monad** | Markets on Anchored aStocks (aNVDA, aSPY, aQQQ, aAAPL, aTSLA, aCOIN, aMSTR, aGLD), Mento GBPm, WMON, quoted in Agora AUSD. References from Chainlink GBP/USD, MON/USD and AUSD/USD. | `deploy/monad-mainnet.json` (verified by RPC); fork tests on real state |

## Mainnet facts the design relies on

All verified on 2026-10-03 against `https://rpc.monad.xyz`.

**Tokens and supplies**

| Asset | Details |
|---|---|
| AUSD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`, 6 decimals, 146.9M supply |
| aNVDA | 57.8 supply. BeaconProxy; implementation `0x45ad…70f5`; `COMPLIANCE()` = `0xF1aeD4…3276` |
| WMON | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` |
| GBPm | `0x39bb4E0a204412bB98e821d25e7d955e69d40Fd1`, 18 decimals |

**Chainlink feeds**

| Feed | Decimals |
|---|---|
| GBP/USD | 18 |
| XAU/USD | 8 |
| MON/USD | 8 |
| AUSD/USD | 8 (slower heartbeat, hence a separate quote-feed max age) |

**Anchored compliance** (measured on a fork):
- aStocks move freely between non-denylisted addresses; there is no allowlist on transfer or mint.
- The issuer's denylist is enforced inside the token.
- Unison mirrors it at every value movement (`IssuerDenylistEligibility`). This is proven against the live compliance contract in `MonadForkTest`.

**Public RPC limit:** `eth_getLogs` is capped at a 100-block range. The indexer uses a dedicated RPC, or HyperSync.

## Cost at Monad prices

These figures use the 100 gwei minimum base fee and MON ≈ $0.034.

| Action | Gas (Monad rules) | ≈ USD |
|---|---:|---:|
| Place an order (steady state) | 133k | $0.0005 |
| Claim two fills | 177k | $0.0006 |
| Clear a 200-order batch | 6.1M | $0.02 |
| Full 10-market production deploy | ≈52M | ≈$0.18 |
