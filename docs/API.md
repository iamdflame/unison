# Unison public APIs: tape and relayer

Two HTTP services sit beside the contracts:

- **The tape** (`services/tape`) indexes every event into SQLite and serves history over REST and live data over SSE. It is the public trade report (TSV "public trade data").
- **The relayer** (`services/relayer`) submits signed gateway actions, so users and agents never need gas.

Typed clients live in `@unison/sdk` (`TapeClient`, `RelayerClient`).

**Live endpoints:**

| | Mainnet (chain 143) | Testnet (chain 10143) |
|---|---|---|
| Tape | https://unison-tape-mainnet-production.up.railway.app | https://unison-tape-production.up.railway.app |
| Relayer | https://unison-relayer-mainnet-production.up.railway.app (no faucet) | https://unison-relayer-production.up.railway.app |

## Conventions

- **Amounts** are decimal strings of integer base units (`"2000000000000000000"`). They are never floats.
- **Prices** are decimal strings of quote units per one whole base token, so AUSD has 6 decimals and `"181200000"` = $181.20.
- **Times** are milliseconds since the epoch. Block timestamps are whole seconds on Monad, so `ts = timestamp × 1000`.
- **Addresses** are lowercased on output and accepted in any case.
- **Errors** look like `{ "error": { "code": "NotEligible", "message": "Your account isn't eligible …" } }`, with HTTP 400, 404, 429 or 503. The `code` is the decoded custom-error name (see `@unison/sdk` `decodeUnisonError`) or one of `INVALID`, `RATE_LIMITED`, `NOT_FOUND`, `FAUCET_DISABLED`, `UNAVAILABLE`, `UNKNOWN` (an on-chain failure with no decodable reason).
- **CORS** is an allowlist (`CORS_ORIGINS`, comma-separated) and sends `Vary: Origin`.

---

## Tape

### `GET /health`
```json
{ "ok": true, "chainId": 143, "head": 110314663, "indexed": 110314661, "lagBlocks": 2, "startBlock": 110200000 }
```

### Markets

#### `GET /v1/markets`

Returns `{ markets: MarketSummary[] }`, one per market.

```ts
interface MarketSummary {
  id: number; symbol: string;            // "aNVDA/AUSD"
  base: string; quote: string; vault: string | null;
  reference: "operator" | "chainlink" | "pyth" | "manual";
  tickSize: string; baseUnit: string; baseDecimals: number; quoteDecimals: number;
  status: 0 | 1 | 2 | 3;                 // OPEN EXTENDED CLOSED HALTED (last print)
  regime: "LIVE" | "EXTENDED" | "DISCOVERY" | "REOPENING" | "HALTED";
  halted: boolean;
  lastPrint: Print | null;               // last print with volume > 0
  auctions: number;                      // batches cleared (incl. empty)
  ref: { price: string; publishTimeMs: number; status: number } | null;   // latest known reference
  volume24h: string;                     // base units
  prints24h: number;
  open24h: string | null;                // first traded price in the window
}
```

`regime` is `"HALTED"` while a `HaltSet` halt is in force, even before the next print. `ref` comes from the relay's `/prices` when the tape runs with `RELAY_URL` (`publishTimeMs` is when the tape observed it). Otherwise it is the newer of the last `ReferenceAccepted` and the last print's reference. A Chainlink-referenced market (all of mainnet's) moves between prints without the tape seeing it; read the adapter for the current price (`ChainlinkReference.read`, or `LightReader.reference` below). `prints24h` counts traded prints.

#### `GET /v1/markets/:id`

Returns one `MarketSummary`.

#### `GET /v1/markets/:id/prints?limit=100&before=<upTo>&traded=1`

Returns `{ prints: Print[] }`, newest first. `traded=1` drops empty batches. `limit` is capped at 1000.

```ts
interface Print {
  marketId: number; upTo: number; block: number; tx: string; logIndex: number; ts: number;
  tick: number; price: string; volume: string;           // 0 / "0" / "0" when nothing traded
  refPrice: string; refTimeMs: number; status: number; regime: string;
  bandLo: number; bandHi: number;                        // ticks; 0 when halted
  receiptHash: string; prevReceiptHash: string;
  chainOk: boolean;                                      // receipt hash chain verified by the tape
  deviationBps: number | null;                           // (price − ref) / ref in bp, null when no trade
}
```

#### `GET /v1/markets/:id/prints.csv?from=&to=`

The same rows as CSV, oldest first. `from` and `to` are times in ms.

#### `GET /v1/markets/:id/candles?res=1m|5m|15m|1h|1d&from=&to=`

Returns `{ candles: { t: number; o: string; h: string; l: string; c: string; v: string; n: number }[] }`. Only traded prints count. `n` is the number of prints. The defaults are `res=1m` and the last 500 candles; one request returns at most 5000.

#### `GET /v1/markets/:id/fairness?window=1h|24h|7d`

```ts
{
  batches: number; traded: number; volume: string;
  meanAbsDevBps: number; p95AbsDevBps: number; maxAbsDevBps: number;   // |print − reference|
  meanRefLagMs: number; p95RefLagMs: number;                           // reference publish time − batch close
  chainOk: boolean;                                                    // every receipt in the window links
  histogram: { bps: number; count: number }[];                         // deviation buckets of 1 bp, ±50
}
```

The batch close is the timestamp of block `upTo`. The histogram always has 101 buckets, from −50 to +50; deviations beyond them count in the edge buckets.

#### `GET /v1/markets/:id/pending`

Returns orders placed after the last clear and not yet cancelled:

```ts
{ lastCleared: number; orders: { account: string; slot: number; side: 0 | 1; tick: number; qty: string; flags: number; batch: number }[] }
```

#### `GET /v1/stats`

Who trades on the venue: accounts with at least one fill. The venue's own vaults are left out, and its team is counted apart (`TEAM_ACCOUNTS`, plus the deployment's operator accounts).

```ts
{ traders: number;                 // accounts with fills, other than the vaults and the team
  teamTraders: number;
  byMarket: Record<number, number>; // traders per market id
  firstOutsideFillBlock: number | null }
```

A fill is a claim that carried the other asset: base to a buyer, quote to a seller.

### Accounts

#### `GET /v1/accounts/:addr/orders?status=open|all`
```ts
{ orders: {
    marketId: number; slot: number; side: 0 | 1; tick: number; qty: string; flags: number; batch: number;
    placedTx: string; placedTs: number;
    status: "pending" | "open" | "closed" | "cancelled";   // closed = fully filled or IOC remainder released
    filled: string; quote: string; fee: string; avgPrice: string | null;
    claims: { tx: string; ts: number; baseAmount: string; quoteAmount: string; fee: string; done: boolean }[];
    fills: { upTo: number; block: number; ts: number; tick: number; price: string; qty: string; volume: string;
             refPrice: string; bandLo: number; bandHi: number; receiptHash: string; exact: boolean }[];
    settling: boolean;   // an auction since the last claim crossed this order: a fill is on its way
} [] }
```

`status` defaults to `open` (pending and open orders). Amounts come from the order's `Claimed` events, which the keeper sends every block:

- **Bids** receive base as they fill. When the order is done they settle quote: `quote` = lock − refund − fee, excluding the fee.
- **Asks** receive net quote as they fill. `quote` is gross, net + fee. The unfilled base comes back when the order is done.

`fills` lists what each auction gave the order, at that auction's uniform price, oldest first. The keeper claims after every clear, so each claim pays out the order's crossing auctions since the previous claim: a bid's claim carries the base it bought, an ask's the gross quote it sold for. A claim that covers one auction gives an exact fill. A claim that covers several is apportioned by auction volume, and those fills have `exact: false`. Auctions that crossed the order but haven't been claimed yet don't appear; `settling` is true while one is outstanding.

A price better than your limit is not always a full fill. When your order is the marginal one on the long side, it is rationed, keeps its place, and joins later auctions.

Until an order is done, a bid's `quote` and an ask's `filled` are summed from `fills`.

#### `GET /v1/accounts/:addr/fills?limit=`

Returns `{ fills: { marketId; slot; side; baseAmount; quoteAmount; fee; done; tx; block; ts }[] }`. These come from the `Claimed` events.

#### `GET /v1/accounts/:addr/transfers`

Returns `{ transfers: { kind: "deposit" | "withdraw"; token; amount; counterparty; tx; ts }[] }`.

#### `GET /v1/accounts/:addr/sessions`

Returns `{ sessions: { key; expiry; maxQty; maxNotional; marketMask; tx; ts }[] }`. This is the latest grant per key; `expiry` 0 means revoked.

#### `GET /v1/passkeys/:account`

Returns `{ account, qx, qy }` from `PasskeyRegistered`, or 404 if the account isn't registered.

### Vaults

#### `GET /v1/vaults/:addr/history?res=1h|1d`

Returns `{ points: { t; nav; supply; sharePrice; spreadPnl; inventoryPnl; base; quote }[] }`. `sharePrice` is in quote units per 1e(decimals) shares.

#### `GET /v1/vaults/:addr/flows?owner=`

Returns `{ flows: { id; owner; kind: "deposit" | "redeem"; amount; requestedTx; requestedTs; executed: null | { tx; ts; shares?; baseOut?; quoteOut?; swingFee } }[] }`, newest first. `amount` is quote units for a deposit and shares for a redeem. `swingFee` is the fee in quote units for a deposit, and the rate in bps for a redeem, because `Redeemed.swingFee` is a rate.

### Receipts (fill certificates)

#### `GET /v1/receipts/:marketId/:account/:slot`
```ts
{ order: AccountOrder; prints: Print[];        // the auctions that filled it
  verification: { chainOk: boolean; recomputed: boolean | null } }
```

The receipt describes the slot's latest order.

- `chainOk`: every listed print links into the receipt hash chain.
- `recomputed`: for a settled order, whether it recomputes from the uniform prices of the auctions that filled it, within the valuation's rounding (3 units per auction). For a bid, what it paid must equal Σ `qty × price / baseUnit`, rounded up per auction. For an ask, its fills plus the base returned must add up to the order. It is `null` while the order is open, when nothing filled, when a claim covered several auctions, or when a claim can't be matched to an auction in view.

### Live stream (SSE)

`GET /v1/stream?topics=heads,prints,regime,account:0xabc…`

Each event's `id` is `"<block>:<logIndex>"`; heads use `"<block>:-1"`. The server replays everything after `Last-Event-ID` for up to 10 minutes, and sends a keepalive comment every 15 s. Browsers can't set that header on the first connection, so it is also accepted as `?lastEventId=`. At least one topic is required.

| event | data |
|---|---|
| `head` | `{ block, ts }`. One per block, deduplicated across Monad commit states |
| `print` | `Print` |
| `regime` | `{ marketId, kind: "halt" \| "regime" \| "cap" \| "tier" \| "notice", data }` |
| `order` / `fill` / `transfer` / `session` | Account-scoped rows, with the shapes above (requires the `account:` topic) |

Topics may be scoped: `prints:0`, `regime:0`.

---

## Relayer

Every action is checked by an `eth_call` simulation before it's accepted. Jobs are persisted and each queue is flushed once per block, with gas estimated per transaction × 1.2 (Monad charges the gas limit):

- **Orders** go in one `placeBatch`. Its limit is never below the sum of the orders' own estimates, because `placeBatch` catches failing orders.
- **Cancels, withdrawals, session grants and claims** are one transaction each, because the gateway has no batch entry point for them.

An expired deadline, a nonce already in flight (`NonceUsed`) and a session-signed withdrawal (`SessionNotAllowed`) are refused before simulation.

| Method and path | Body | Response |
|---|---|---|
| `POST /v1/orders` | `{ order, sig }` (`orderToJson`) | `202 { id }` |
| `POST /v1/cancels` | `{ cancel, sig }` | `202 { id }` |
| `POST /v1/withdrawals` | `{ withdraw, sig }` | `202 { id }`. Withdrawals need the account's own signature; session keys are rejected |
| `POST /v1/sessions` | `{ session, sig }` | `202 { id }` (`grantSessionSigned`; `expiry` 0 revokes) |
| `POST /v1/passkeys` | `{ qx, qy }` (0x-prefixed 32-byte hex) | `200 { account, registered: true, tx: string \| null }`. Idempotent |
| `POST /v1/claims` | `{ account, slots: number[] }` | `202 { id }`. Permissionless; the keeper also auto-claims |
| `POST /v1/faucet` | `{ account }` | `202 { id }`. Devnet and testnet only (`FAUCET_DISABLED` on mainnet). Mints mock AUSD plus base tokens and deposits them with `depositFor`. Limited to 1 per account per 24 h and 3 per IP per day |
| `GET /v1/jobs/:id` | | `{ id, kind, status: "queued" \| "sent" \| "done" \| "failed", tx?, result?: { slot? }, error?: { code, message } }` |
| `GET /v1/orders/:id` | | Alias of `/v1/jobs/:id` (legacy) |
| `GET /health` | | `{ ok, relayer, chainId, queued, faucet }` |

**Rate limits.** Token buckets per IP and per account. Exceeding them returns `429 { error: { code: "RATE_LIMITED" } }`, with `Retry-After`. The faucet's own limits answer the same way: 1 per account per 24 h, 3 per IP per 24 h, and a global daily budget (`FAUCET_DAILY_BUDGET`).

`RelayerClient.waitForJob` throws a `RelayerError`: the job's `error` code when it fails, and `TIMEOUT` when it outlives its timeout.

**Warning.** A passkey account (`OrderGateway.passkeyAccount(qx, qy)`) has no private key. Fund it only through `UnisonExchange.depositFor`. Tokens sent straight to that address cannot be recovered.

---

## Chain reads without a contract toolkit (`LightReader`)

`@unison/sdk/light` reads the chain with plain JSON-RPC `eth_call`s, ABI-encoded by hand. `test/light.test.ts` checks each one against viem.

| Method | Contract call | Returns |
|---|---|---|
| `depth(market, side, lo, hi)`, `depthRange(…)` | `UnisonExchange.depth` | resting quantity per tick |
| `balanceOf(account, token)` | `UnisonExchange.balanceOf` | a free ledger balance |
| `curve(source, market, refPrice, status, refTick, lo, hi)` | `LiquidityVault.curve` (`ICurveSource`) | the vault's bids and asks for one auction, before the venue caps them by the vault's balances |
| `reference(adapter, market)` | `IReferenceAdapter.read(market, 0, 0x)` | `{ price, publishTimeMs, status }`: the price an auction would clear against now, for push feeds |
