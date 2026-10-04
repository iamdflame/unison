# Unison public APIs: tape and relayer

Two HTTP services sit beside the contracts:

- **The tape** (`services/tape`) indexes every event into SQLite and serves history over REST and live data over SSE. It is the public trade report (TSV "public trade data").
- **The relayer** (`services/relayer`) submits signed gateway actions, so users and agents never need gas.

Typed clients live in `@unison/sdk` (`TapeClient`, `RelayerClient`).

## Conventions

- **Amounts** are decimal strings of integer base units (`"2000000000000000000"`). They are never floats.
- **Prices** are decimal strings of quote units per one whole base token, so AUSD has 6 decimals and `"181200000"` = $181.20.
- **Times** are milliseconds since the epoch. Block timestamps are whole seconds on Monad, so `ts = timestamp × 1000`.
- **Addresses** are lowercased on output and accepted in any case.
- **Errors** look like `{ "error": { "code": "NotEligible", "message": "Your account isn't eligible …" } }`, with HTTP 400, 404, 429 or 503. The `code` is the decoded custom-error name (see `@unison/sdk` `decodeUnisonError`) or one of `INVALID`, `RATE_LIMITED`, `NOT_FOUND`, `FAUCET_DISABLED`, `UNAVAILABLE`.
- **CORS** is an allowlist (`CORS_ORIGINS`, comma-separated) and sends `Vary: Origin`.

---

## Tape

### `GET /health`
```json
{ "ok": true, "chainId": 143, "head": 110314663, "indexed": 110314661, "lagBlocks": 2, "startBlock": 110200000 }
```

### Markets

#### `GET /v1/markets`

Returns one `MarketSummary` per market.

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

#### `GET /v1/markets/:id`

Returns one `MarketSummary`.

#### `GET /v1/markets/:id/prints?limit=100&before=<upTo>&traded=1`

Returns `{ prints: Print[] }`, newest first. `traded=1` drops empty batches.

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

The same rows as CSV.

#### `GET /v1/markets/:id/candles?res=1m|5m|15m|1h|1d&from=&to=`

Returns `{ candles: { t: number; o: string; h: string; l: string; c: string; v: string; n: number }[] }`. Only traded prints count. `n` is the number of prints.

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

#### `GET /v1/markets/:id/pending`

Returns orders placed after the last clear and not yet cancelled:

```ts
{ lastCleared: number; orders: { account: string; slot: number; side: 0 | 1; tick: number; qty: string; flags: number; batch: number }[] }
```

### Accounts

#### `GET /v1/accounts/:addr/orders?status=open|all`
```ts
{ orders: {
    marketId: number; slot: number; side: 0 | 1; tick: number; qty: string; flags: number; batch: number;
    placedTx: string; placedTs: number;
    status: "pending" | "open" | "closed" | "cancelled";   // closed = fully filled or IOC remainder released
    filled: string; quote: string; fee: string; avgPrice: string | null;
    claims: { tx: string; ts: number; baseAmount: string; quoteAmount: string; fee: string; done: boolean }[];
} [] }
```

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

Returns `{ flows: { id; owner; kind: "deposit" | "redeem"; amount; requestedTx; requestedTs; executed: null | { tx; ts; shares?; baseOut?; quoteOut?; swingFee } }[] }`.

### Receipts (fill certificates)

#### `GET /v1/receipts/:marketId/:account/:slot`
```ts
{ order: AccountOrder; prints: Print[];        // the auctions that filled it
  verification: { chainOk: boolean; recomputed: boolean | null } }
```

### Live stream (SSE)

`GET /v1/stream?topics=heads,prints,regime,account:0xabc…`

Each event's `id` is `"<block>:<logIndex>"`. The server replays everything after `Last-Event-ID` for up to 10 minutes, and sends a keepalive comment every 15 s.

| event | data |
|---|---|
| `head` | `{ block, ts }`. One per block, deduplicated across Monad commit states |
| `print` | `Print` |
| `regime` | `{ marketId, kind: "halt" \| "regime" \| "cap" \| "tier" \| "notice", data }` |
| `order` / `fill` / `transfer` / `session` | Account-scoped rows, with the shapes above (requires the `account:` topic) |

Topics may be scoped: `prints:0`, `regime:0`.

---

## Relayer

Every action is checked by an `eth_call` simulation before it's accepted. Jobs are persisted and flushed in at most one batch transaction per block, with gas estimated per batch (Monad charges the gas limit).

| Method and path | Body | Response |
|---|---|---|
| `POST /v1/orders` | `{ order, sig }` (`orderToJson`) | `202 { id }` |
| `POST /v1/cancels` | `{ cancel, sig }` | `202 { id }` |
| `POST /v1/withdrawals` | `{ withdraw, sig }` | `202 { id }`. Withdrawals need the account's own signature; session keys are rejected |
| `POST /v1/sessions` | `{ session, sig }` | `202 { id }` (`grantSessionSigned`; `expiry` 0 revokes) |
| `POST /v1/passkeys` | `{ qx, qy }` (0x-prefixed 32-byte hex) | `200 { account, registered: true, tx: string \| null }`. Idempotent |
| `POST /v1/claims` | `{ account, slots: number[] }` | `202 { id }`. Permissionless; the keeper also auto-claims |
| `POST /v1/faucet` | `{ account }` | `202 { id }`. Devnet and testnet only. Mints mock AUSD plus base tokens and deposits them with `depositFor`. Limited to 1 per account per 24 h and 3 per IP per day |
| `GET /v1/jobs/:id` | | `{ id, kind, status: "queued" \| "sent" \| "done" \| "failed", tx?, result?: { slot? }, error?: { code, message } }` |
| `GET /v1/orders/:id` | | Alias of `/v1/jobs/:id` (legacy) |
| `GET /health` | | `{ ok, relayer, chainId, queued, faucet }` |

**Rate limits.** Token buckets per IP and per account. Exceeding them returns `429 { error: { code: "RATE_LIMITED" } }`.

**Warning.** A passkey account (`OrderGateway.passkeyAccount(qx, qy)`) has no private key. Fund it only through `UnisonExchange.depositFor`. Tokens sent straight to that address cannot be recovered.
