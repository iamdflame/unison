/**
 * Tape storage. Every indexed log becomes one row keyed by (block, logIndex), so re-ingesting a window is a
 * no-op and a log the chain retracts (`removed`) deletes exactly one row; everything else (order state, fills,
 * candles, fairness) is derived from these rows when queried. Bigints are stored as decimal TEXT.
 *
 * `TapeStore` is the only thing the indexer and the API see; `SqliteTapeStore` implements it on node:sqlite
 * (WAL mode). Another backend only has to implement the same interface.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

/** Position, transaction and time (ms) of the log a row came from. */
export interface LogRef {
  block: number;
  logIndex: number;
  tx: string;
  ts: number;
}

export interface PrintRow extends LogRef {
  marketId: number;
  upTo: number;
  tick: number;
  price: string;
  volume: string;
  refPrice: string;
  refTimeMs: number;
  status: number;
  bandLo: number;
  bandHi: number;
  receiptHash: string;
  // derived from the previous print of the market (recomputed when an earlier print arrives late)
  prevReceiptHash: string;
  chainOk: boolean;
  regime: string;
  deviationBps: number | null;
  /** timestamp (s) of block `upTo`, when known: the batch close for reference-lag statistics */
  closeTs: number | null;
}

export interface OrderPlacedRow extends LogRef {
  marketId: number;
  account: string;
  slot: number;
  side: number;
  tick: number;
  qty: string;
  flags: number;
  batch: number;
}

export interface OrderCancelledRow extends LogRef {
  marketId: number;
  account: string;
  slot: number;
  releasedQty: string;
}

export interface ClaimRow extends LogRef {
  marketId: number;
  account: string;
  slot: number;
  side: number;
  baseAmount: string;
  quoteAmount: string;
  fee: string;
  done: boolean;
}

export interface TransferRow extends LogRef {
  kind: "deposit" | "withdraw";
  account: string;
  token: string;
  amount: string;
  counterparty: string;
}

export interface SessionRow extends LogRef {
  account: string;
  key: string;
  expiry: number;
  maxQty: string;
  maxNotional: string;
  marketMask: string;
}

export interface PasskeyRow extends LogRef {
  account: string;
  qx: string;
  qy: string;
}

export interface RelayedRow extends LogRef {
  account: string;
  ok: boolean;
  authorizedBy: string | null;
  kind: number | null;
  action: string | null;
  ref: string | null;
  index: number | null;
  reason: string | null;
}

export interface VaultEventRow extends LogRef {
  vault: string;
  event: "DepositRequested" | "RedeemRequested" | "Deposited" | "Redeemed";
  requestId: number;
  owner: string;
  /** requests: assets (deposit) or shares (redeem); Deposited: assets */
  amount: string | null;
  shares: string | null;
  nav: string | null;
  baseOut: string | null;
  quoteOut: string | null;
  /** Deposited: fee in quote units; Redeemed: the rate in bps */
  swingFee: string | null;
}

export interface VaultFillRow extends LogRef {
  vault: string;
  batch: number;
  price: string;
  refPrice: string;
  bought: string;
  sold: string;
  spreadPnl: string;
}

export interface CurveFillRow extends LogRef {
  marketId: number;
  source: string;
  upTo: number;
  boughtBase: string;
  paidQuote: string;
  soldBase: string;
  receivedQuote: string;
}

export type RegimeEventKind = "halt" | "regime" | "cap" | "tier" | "notice";

export interface RegimeEventRow extends LogRef {
  marketId: number;
  kind: RegimeEventKind;
  /** JSON object */
  data: string;
}

export interface ReferenceRow extends LogRef {
  marketId: number;
  batch: number;
  price: string;
  publishTimeMs: number;
  status: number;
  signers: number;
}

export interface VaultSnapshotRow {
  vault: string;
  t: number;
  block: number;
  nav: string;
  supply: string;
  base: string;
  quote: string;
  spreadPnl: string;
  inventoryPnl: string;
  decimals: number;
}

/** One indexed log, tagged with the table it lives in. */
export type TapeRecord =
  | { table: "prints"; row: PrintRow }
  | { table: "orders_placed"; row: OrderPlacedRow }
  | { table: "orders_cancelled"; row: OrderCancelledRow }
  | { table: "claims"; row: ClaimRow }
  | { table: "transfers"; row: TransferRow }
  | { table: "sessions"; row: SessionRow }
  | { table: "passkeys"; row: PasskeyRow }
  | { table: "relayed"; row: RelayedRow }
  | { table: "vault_events"; row: VaultEventRow }
  | { table: "vault_fills"; row: VaultFillRow }
  | { table: "curve_fills"; row: CurveFillRow }
  | { table: "regime_events"; row: RegimeEventRow }
  | { table: "references"; row: ReferenceRow };

export type TapeTable = TapeRecord["table"];
type RowOf<T extends TapeTable> = Extract<TapeRecord, { table: T }>["row"];

export interface PrintQuery {
  limit?: number;
  /** upTo < before */
  before?: number;
  traded?: boolean;
  /** ts range in ms, inclusive */
  from?: number;
  to?: number;
  /** oldest first (default newest first) */
  asc?: boolean;
}

export interface TapeStore {
  /** Runs `fn` atomically. Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T;
  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
  blockTs(block: number): number | undefined;
  putBlockTs(block: number, ts: number): void;

  /** Inserts one indexed log. false when the same log (same tx) is already stored. A different log at the same
   *  (block, logIndex), after a reorg, replaces the old one wherever it was. */
  insert(rec: TapeRecord): boolean;
  /** Removes the log stored at (block, logIndex) (only if it came from `tx`, when given); returns it. */
  retract(block: number, logIndex: number, tx?: string): TapeRecord | undefined;
  updatePrintDerived(
    block: number,
    logIndex: number,
    d: Pick<PrintRow, "prevReceiptHash" | "chainOk" | "regime" | "deviationBps">,
  ): void;

  prints(marketId: number, q?: PrintQuery): PrintRow[];
  print(block: number, logIndex: number): PrintRow | undefined;
  /** The print immediately before (block, logIndex) in the market, in chain order. */
  printBefore(marketId: number, block: number, logIndex: number): PrintRow | undefined;
  /** Every print after (block, logIndex) in the market, oldest first. */
  printsAfter(marketId: number, block: number, logIndex: number): PrintRow[];
  lastPrint(marketId: number, traded?: boolean): PrintRow | undefined;
  printCount(marketId: number): number;
  /** Prints (traded or not) with upTo >= fromUpTo, oldest first. */
  printsFromUpTo(marketId: number, fromUpTo: number, limit: number): PrintRow[];
  /** Traded prints with upTo >= fromUpTo at a price a limit at `tick` accepts (bids: <= tick, asks: >= tick), oldest first. */
  crossingPrints(marketId: number, fromUpTo: number, side: number, tick: number, limit: number): PrintRow[];

  ordersPlaced(account: string, marketId?: number): OrderPlacedRow[];
  /** Everything that happened in one order slot (placements, claims, cancels), oldest first. */
  slotEvents(
    account: string,
    marketId: number,
    slot: number,
  ): { placed: OrderPlacedRow[]; claims: ClaimRow[]; cancels: OrderCancelledRow[] };
  ordersPlacedAfterBatch(marketId: number, batch: number): OrderPlacedRow[];
  cancels(account: string): OrderCancelledRow[];
  /** Cancels in a market by any of `accounts`. */
  cancelsByAccounts(marketId: number, accounts: string[]): OrderCancelledRow[];
  claims(account: string, limit?: number): ClaimRow[];
  transfers(account: string): TransferRow[];
  sessions(account: string): SessionRow[];
  passkey(account: string): PasskeyRow | undefined;
  regimeEvents(marketId: number, kind?: RegimeEventKind): RegimeEventRow[];
  lastReference(marketId: number): ReferenceRow | undefined;
  vaultEvents(vault: string, owner?: string): VaultEventRow[];

  putVaultSnapshot(s: VaultSnapshotRow): void;
  vaultSnapshots(vault: string, sinceMs?: number): VaultSnapshotRow[];

  close(): void;
}

// ---------------------------------------------------------------------------------------------- SQLite

type ColType = "int" | "text" | "bool" | "real";
type Column = readonly [column: string, field: string, type: ColType, nullable?: boolean];

const LOG_COLUMNS: readonly Column[] = [
  ["block", "block", "int"],
  ["log_index", "logIndex", "int"],
  ["tx", "tx", "text"],
  ["ts", "ts", "int"],
];

const TABLES: Record<TapeTable, readonly Column[]> = {
  prints: [
    ["market_id", "marketId", "int"],
    ["up_to", "upTo", "int"],
    ["tick", "tick", "int"],
    ["price", "price", "text"],
    ["volume", "volume", "text"],
    ["ref_price", "refPrice", "text"],
    ["ref_time_ms", "refTimeMs", "int"],
    ["status", "status", "int"],
    ["band_lo", "bandLo", "int"],
    ["band_hi", "bandHi", "int"],
    ["receipt_hash", "receiptHash", "text"],
    ["prev_receipt_hash", "prevReceiptHash", "text"],
    ["chain_ok", "chainOk", "bool"],
    ["regime", "regime", "text"],
    ["deviation_bps", "deviationBps", "real", true],
    ["close_ts", "closeTs", "int", true],
  ],
  orders_placed: [
    ["market_id", "marketId", "int"],
    ["account", "account", "text"],
    ["slot", "slot", "int"],
    ["side", "side", "int"],
    ["tick", "tick", "int"],
    ["qty", "qty", "text"],
    ["flags", "flags", "int"],
    ["batch", "batch", "int"],
  ],
  orders_cancelled: [
    ["market_id", "marketId", "int"],
    ["account", "account", "text"],
    ["slot", "slot", "int"],
    ["released_qty", "releasedQty", "text"],
  ],
  claims: [
    ["market_id", "marketId", "int"],
    ["account", "account", "text"],
    ["slot", "slot", "int"],
    ["side", "side", "int"],
    ["base_amount", "baseAmount", "text"],
    ["quote_amount", "quoteAmount", "text"],
    ["fee", "fee", "text"],
    ["done", "done", "bool"],
  ],
  transfers: [
    ["kind", "kind", "text"],
    ["account", "account", "text"],
    ["token", "token", "text"],
    ["amount", "amount", "text"],
    ["counterparty", "counterparty", "text"],
  ],
  sessions: [
    ["account", "account", "text"],
    ["key", "key", "text"],
    ["expiry", "expiry", "int"],
    ["max_qty", "maxQty", "text"],
    ["max_notional", "maxNotional", "text"],
    ["market_mask", "marketMask", "text"],
  ],
  passkeys: [
    ["account", "account", "text"],
    ["qx", "qx", "text"],
    ["qy", "qy", "text"],
  ],
  relayed: [
    ["account", "account", "text"],
    ["ok", "ok", "bool"],
    ["authorized_by", "authorizedBy", "text", true],
    ["kind", "kind", "int", true],
    ["action", "action", "text", true],
    ["ref", "ref", "text", true],
    ["idx", "index", "int", true],
    ["reason", "reason", "text", true],
  ],
  vault_events: [
    ["vault", "vault", "text"],
    ["event", "event", "text"],
    ["request_id", "requestId", "int"],
    ["owner", "owner", "text"],
    ["amount", "amount", "text", true],
    ["shares", "shares", "text", true],
    ["nav", "nav", "text", true],
    ["base_out", "baseOut", "text", true],
    ["quote_out", "quoteOut", "text", true],
    ["swing_fee", "swingFee", "text", true],
  ],
  vault_fills: [
    ["vault", "vault", "text"],
    ["batch", "batch", "int"],
    ["price", "price", "text"],
    ["ref_price", "refPrice", "text"],
    ["bought", "bought", "text"],
    ["sold", "sold", "text"],
    ["spread_pnl", "spreadPnl", "text"],
  ],
  curve_fills: [
    ["market_id", "marketId", "int"],
    ["source", "source", "text"],
    ["up_to", "upTo", "int"],
    ["bought_base", "boughtBase", "text"],
    ["paid_quote", "paidQuote", "text"],
    ["sold_base", "soldBase", "text"],
    ["received_quote", "receivedQuote", "text"],
  ],
  regime_events: [
    ["market_id", "marketId", "int"],
    ["kind", "kind", "text"],
    ["data", "data", "text"],
  ],
  references: [
    ["market_id", "marketId", "int"],
    ["batch", "batch", "int"],
    ["price", "price", "text"],
    ["publish_time_ms", "publishTimeMs", "int"],
    ["status", "status", "int"],
    ["signers", "signers", "int"],
  ],
};

const SQL_TYPE: Record<ColType, string> = { int: "INTEGER", text: "TEXT", bool: "INTEGER", real: "REAL" };

const tableSql = (name: string, cols: readonly Column[]) =>
  `CREATE TABLE "${name}" (${[...LOG_COLUMNS, ...cols]
    .map(([c, , t, nullable]) => `${c} ${SQL_TYPE[t]}${nullable ? "" : " NOT NULL"}`)
    .join(", ")}, PRIMARY KEY (block, log_index)) WITHOUT ROWID`;

/** Schema migrations, applied in order and tracked with PRAGMA user_version. */
const MIGRATIONS: readonly string[] = [
  [
    "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE blocks (number INTEGER PRIMARY KEY, ts INTEGER NOT NULL)",
    // which table holds the log at (block, log_index): reorg replacement and retraction
    "CREATE TABLE logs (block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx TEXT NOT NULL, tbl TEXT NOT NULL, PRIMARY KEY (block, log_index)) WITHOUT ROWID",
    ...Object.entries(TABLES).map(([name, cols]) => tableSql(name, cols)),
    "CREATE INDEX prints_market ON prints (market_id, block, log_index)",
    "CREATE INDEX prints_market_ts ON prints (market_id, ts)",
    "CREATE INDEX prints_market_upto ON prints (market_id, up_to)",
    "CREATE INDEX orders_account ON orders_placed (account, block, log_index)",
    "CREATE INDEX orders_market_batch ON orders_placed (market_id, batch)",
    "CREATE INDEX cancels_account ON orders_cancelled (account, market_id, slot)",
    "CREATE INDEX claims_account ON claims (account, block, log_index)",
    "CREATE INDEX claims_slot ON claims (account, market_id, slot)",
    "CREATE INDEX orders_slot ON orders_placed (account, market_id, slot)",
    "CREATE INDEX transfers_account ON transfers (account, block, log_index)",
    "CREATE INDEX sessions_account ON sessions (account, key)",
    "CREATE INDEX passkeys_account ON passkeys (account)",
    "CREATE INDEX relayed_account ON relayed (account)",
    "CREATE INDEX vault_events_vault ON vault_events (vault, request_id)",
    "CREATE INDEX vault_fills_vault ON vault_fills (vault, block)",
    "CREATE INDEX curve_fills_market ON curve_fills (market_id, block)",
    'CREATE INDEX regime_market ON regime_events (market_id, kind, block, log_index)',
    'CREATE INDEX references_market ON "references" (market_id, block, log_index)',
    "CREATE TABLE vault_snapshots (vault TEXT NOT NULL, t INTEGER NOT NULL, block INTEGER NOT NULL, nav TEXT NOT NULL, supply TEXT NOT NULL, base TEXT NOT NULL, quote TEXT NOT NULL, spread_pnl TEXT NOT NULL, inventory_pnl TEXT NOT NULL, decimals INTEGER NOT NULL, PRIMARY KEY (vault, t)) WITHOUT ROWID",
  ].join(";\n"),
];

type Raw = Record<string, unknown>;

function toSql(v: unknown, t: ColType): SQLInputValue {
  if (v === null || v === undefined) return null;
  if (t === "bool") return v ? 1 : 0;
  if (t === "text") return String(v);
  return Number(v);
}

function fromSql(v: unknown, t: ColType): unknown {
  if (v === null || v === undefined) return null;
  if (t === "bool") return Number(v) !== 0;
  if (t === "text") return String(v);
  return Number(v);
}

export class SqliteTapeStore implements TapeStore {
  readonly db: DatabaseSync;
  private depth = 0;
  private readonly stmts = new Map<string, StatementSync>();

  /** `path` may be ":memory:"; parent directories are created. */
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  private migrate() {
    const v = Number((this.db.prepare("PRAGMA user_version").get() as Raw).user_version);
    for (let i = v; i < MIGRATIONS.length; i++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[i]!);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
      });
    }
  }

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  private all(sql: string, ...params: SQLInputValue[]): Raw[] {
    return this.stmt(sql).all(...params) as Raw[];
  }

  private get(sql: string, ...params: SQLInputValue[]): Raw | undefined {
    return this.stmt(sql).get(...params) as Raw | undefined;
  }

  private rowOf<T extends TapeTable>(table: T, r: Raw): RowOf<T> {
    const out: Raw = {};
    for (const [c, f, t] of [...LOG_COLUMNS, ...TABLES[table]]) out[f] = fromSql(r[c], t);
    return out as unknown as RowOf<T>;
  }

  private rows<T extends TapeTable>(table: T, sql: string, ...params: SQLInputValue[]): RowOf<T>[] {
    return this.all(sql, ...params).map((r) => this.rowOf(table, r));
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.depth--;
    }
  }

  getMeta(key: string): string | undefined {
    const r = this.get("SELECT value FROM meta WHERE key = ?", key);
    return r ? String(r.value) : undefined;
  }

  setMeta(key: string, value: string): void {
    this.stmt("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      key,
      value,
    );
  }

  blockTs(block: number): number | undefined {
    const r = this.get("SELECT ts FROM blocks WHERE number = ?", block);
    return r ? Number(r.ts) : undefined;
  }

  putBlockTs(block: number, ts: number): void {
    this.stmt("INSERT INTO blocks (number, ts) VALUES (?, ?) ON CONFLICT(number) DO UPDATE SET ts = excluded.ts").run(
      block,
      ts,
    );
  }

  insert(rec: TapeRecord): boolean {
    const { table, row } = rec;
    return this.transaction(() => {
      const existing = this.get("SELECT tx, tbl FROM logs WHERE block = ? AND log_index = ?", row.block, row.logIndex);
      if (existing) {
        if (String(existing.tx) === row.tx && String(existing.tbl) === table) return false;
        this.retract(row.block, row.logIndex); // reorg: a different log now sits at this position
      }
      const cols = [...LOG_COLUMNS, ...TABLES[table]];
      const sql = `INSERT INTO "${table}" (${cols.map((c) => c[0]).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
      this.stmt(sql).run(...cols.map(([, f, t]) => toSql((row as unknown as Raw)[f], t)));
      this.stmt("INSERT INTO logs (block, log_index, tx, tbl) VALUES (?, ?, ?, ?)").run(
        row.block,
        row.logIndex,
        row.tx,
        table,
      );
      return true;
    });
  }

  retract(block: number, logIndex: number, tx?: string): TapeRecord | undefined {
    return this.transaction(() => {
      const at = this.get("SELECT tbl, tx FROM logs WHERE block = ? AND log_index = ?", block, logIndex);
      if (!at || (tx !== undefined && String(at.tx) !== tx.toLowerCase())) return undefined;
      const table = String(at.tbl) as TapeTable;
      const r = this.get(`SELECT * FROM "${table}" WHERE block = ? AND log_index = ?`, block, logIndex);
      this.stmt(`DELETE FROM "${table}" WHERE block = ? AND log_index = ?`).run(block, logIndex);
      this.stmt("DELETE FROM logs WHERE block = ? AND log_index = ?").run(block, logIndex);
      return r ? ({ table, row: this.rowOf(table, r) } as TapeRecord) : undefined;
    });
  }

  updatePrintDerived(
    block: number,
    logIndex: number,
    d: Pick<PrintRow, "prevReceiptHash" | "chainOk" | "regime" | "deviationBps">,
  ): void {
    this.stmt(
      "UPDATE prints SET prev_receipt_hash = ?, chain_ok = ?, regime = ?, deviation_bps = ? WHERE block = ? AND log_index = ?",
    ).run(d.prevReceiptHash, d.chainOk ? 1 : 0, d.regime, d.deviationBps, block, logIndex);
  }

  prints(marketId: number, q: PrintQuery = {}): PrintRow[] {
    const where = ["market_id = ?"];
    const params: SQLInputValue[] = [marketId];
    if (q.before !== undefined) {
      where.push("up_to < ?");
      params.push(q.before);
    }
    if (q.traded) where.push("volume != '0'");
    if (q.from !== undefined) {
      where.push("ts >= ?");
      params.push(q.from);
    }
    if (q.to !== undefined) {
      where.push("ts <= ?");
      params.push(q.to);
    }
    const dir = q.asc ? "ASC" : "DESC";
    const limit = q.limit === undefined ? "" : ` LIMIT ${Math.max(0, Math.floor(q.limit))}`;
    return this.rows(
      "prints",
      `SELECT * FROM prints WHERE ${where.join(" AND ")} ORDER BY block ${dir}, log_index ${dir}${limit}`,
      ...params,
    );
  }

  print(block: number, logIndex: number): PrintRow | undefined {
    return this.rows("prints", "SELECT * FROM prints WHERE block = ? AND log_index = ?", block, logIndex)[0];
  }

  printBefore(marketId: number, block: number, logIndex: number): PrintRow | undefined {
    return this.rows(
      "prints",
      "SELECT * FROM prints WHERE market_id = ? AND (block < ? OR (block = ? AND log_index < ?)) ORDER BY block DESC, log_index DESC LIMIT 1",
      marketId,
      block,
      block,
      logIndex,
    )[0];
  }

  printsAfter(marketId: number, block: number, logIndex: number): PrintRow[] {
    return this.rows(
      "prints",
      "SELECT * FROM prints WHERE market_id = ? AND (block > ? OR (block = ? AND log_index > ?)) ORDER BY block ASC, log_index ASC",
      marketId,
      block,
      block,
      logIndex,
    );
  }

  lastPrint(marketId: number, traded = false): PrintRow | undefined {
    return this.prints(marketId, { limit: 1, traded })[0];
  }

  printCount(marketId: number): number {
    return Number(this.get("SELECT COUNT(*) AS n FROM prints WHERE market_id = ?", marketId)?.n ?? 0);
  }

  printsFromUpTo(marketId: number, fromUpTo: number, limit: number): PrintRow[] {
    return this.rows(
      "prints",
      "SELECT * FROM prints WHERE market_id = ? AND up_to >= ? ORDER BY block ASC, log_index ASC LIMIT ?",
      marketId,
      fromUpTo,
      limit,
    );
  }

  crossingPrints(marketId: number, fromUpTo: number, side: number, tick: number, limit: number): PrintRow[] {
    return this.rows(
      "prints",
      `SELECT * FROM prints WHERE market_id = ? AND up_to >= ? AND volume != '0' AND tick ${side === 0 ? "<=" : ">="} ?
       ORDER BY block ASC, log_index ASC LIMIT ?`,
      marketId,
      fromUpTo,
      tick,
      limit,
    );
  }

  ordersPlaced(account: string, marketId?: number): OrderPlacedRow[] {
    if (marketId === undefined) {
      return this.rows("orders_placed", "SELECT * FROM orders_placed WHERE account = ? ORDER BY block, log_index", account);
    }
    return this.rows(
      "orders_placed",
      "SELECT * FROM orders_placed WHERE account = ? AND market_id = ? ORDER BY block, log_index",
      account,
      marketId,
    );
  }

  slotEvents(
    account: string,
    marketId: number,
    slot: number,
  ): { placed: OrderPlacedRow[]; claims: ClaimRow[]; cancels: OrderCancelledRow[] } {
    const where = "WHERE account = ? AND market_id = ? AND slot = ? ORDER BY block, log_index";
    return {
      placed: this.rows("orders_placed", `SELECT * FROM orders_placed ${where}`, account, marketId, slot),
      claims: this.rows("claims", `SELECT * FROM claims ${where}`, account, marketId, slot),
      cancels: this.rows("orders_cancelled", `SELECT * FROM orders_cancelled ${where}`, account, marketId, slot),
    };
  }

  ordersPlacedAfterBatch(marketId: number, batch: number): OrderPlacedRow[] {
    return this.rows(
      "orders_placed",
      "SELECT * FROM orders_placed WHERE market_id = ? AND batch > ? ORDER BY block, log_index",
      marketId,
      batch,
    );
  }

  cancels(account: string): OrderCancelledRow[] {
    return this.rows(
      "orders_cancelled",
      "SELECT * FROM orders_cancelled WHERE account = ? ORDER BY block, log_index",
      account,
    );
  }

  cancelsByAccounts(marketId: number, accounts: string[]): OrderCancelledRow[] {
    if (accounts.length === 0) return [];
    return this.rows(
      "orders_cancelled",
      `SELECT * FROM orders_cancelled WHERE market_id = ? AND account IN (${accounts.map(() => "?").join(", ")}) ORDER BY block, log_index`,
      marketId,
      ...accounts,
    );
  }

  claims(account: string, limit?: number): ClaimRow[] {
    if (limit === undefined) {
      return this.rows("claims", "SELECT * FROM claims WHERE account = ? ORDER BY block, log_index", account);
    }
    return this.rows(
      "claims",
      "SELECT * FROM claims WHERE account = ? ORDER BY block DESC, log_index DESC LIMIT ?",
      account,
      limit,
    );
  }

  transfers(account: string): TransferRow[] {
    return this.rows(
      "transfers",
      "SELECT * FROM transfers WHERE account = ? ORDER BY block DESC, log_index DESC",
      account,
    );
  }

  sessions(account: string): SessionRow[] {
    return this.rows("sessions", "SELECT * FROM sessions WHERE account = ? ORDER BY block, log_index", account);
  }

  passkey(account: string): PasskeyRow | undefined {
    return this.rows(
      "passkeys",
      "SELECT * FROM passkeys WHERE account = ? ORDER BY block DESC, log_index DESC LIMIT 1",
      account,
    )[0];
  }

  regimeEvents(marketId: number, kind?: RegimeEventKind): RegimeEventRow[] {
    if (kind === undefined) {
      return this.rows(
        "regime_events",
        "SELECT * FROM regime_events WHERE market_id = ? ORDER BY block, log_index",
        marketId,
      );
    }
    return this.rows(
      "regime_events",
      "SELECT * FROM regime_events WHERE market_id = ? AND kind = ? ORDER BY block, log_index",
      marketId,
      kind,
    );
  }

  lastReference(marketId: number): ReferenceRow | undefined {
    return this.rows(
      "references",
      'SELECT * FROM "references" WHERE market_id = ? ORDER BY block DESC, log_index DESC LIMIT 1',
      marketId,
    )[0];
  }

  vaultEvents(vault: string, owner?: string): VaultEventRow[] {
    if (owner === undefined) {
      return this.rows("vault_events", "SELECT * FROM vault_events WHERE vault = ? ORDER BY block, log_index", vault);
    }
    return this.rows(
      "vault_events",
      "SELECT * FROM vault_events WHERE vault = ? AND owner = ? ORDER BY block, log_index",
      vault,
      owner,
    );
  }

  putVaultSnapshot(s: VaultSnapshotRow): void {
    this.stmt(
      "INSERT OR REPLACE INTO vault_snapshots (vault, t, block, nav, supply, base, quote, spread_pnl, inventory_pnl, decimals) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(s.vault, s.t, s.block, s.nav, s.supply, s.base, s.quote, s.spreadPnl, s.inventoryPnl, s.decimals);
  }

  vaultSnapshots(vault: string, sinceMs = 0): VaultSnapshotRow[] {
    return this.all("SELECT * FROM vault_snapshots WHERE vault = ? AND t >= ? ORDER BY t", vault, sinceMs).map((r) => ({
      vault: String(r.vault),
      t: Number(r.t),
      block: Number(r.block),
      nav: String(r.nav),
      supply: String(r.supply),
      base: String(r.base),
      quote: String(r.quote),
      spreadPnl: String(r.spread_pnl),
      inventoryPnl: String(r.inventory_pnl),
      decimals: Number(r.decimals),
    }));
  }

  close(): void {
    this.db.close();
  }
}
