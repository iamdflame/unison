/**
 * Persistent job store (node:sqlite, WAL). One table for every action kind, so `/v1/jobs/:id` answers for all
 * of them and a restart picks queued work back up. Payloads are the validated wire JSON (bigints as strings).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { RelayerJob, RelayerJobKind, RelayerJobStatus } from "@unison/sdk/relayer";

export interface JobRow {
  id: string;
  kind: RelayerJobKind;
  status: RelayerJobStatus;
  /** wire JSON of the action */
  payload: string;
  account: string;
  ip: string;
  tx?: string;
  result?: { slot?: number };
  error?: { code: string; message: string };
  /** per-action gas estimate taken at submission (orders) */
  gas?: string;
  /** position inside its batch transaction (orders) */
  batchIndex?: number;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export type JobPatch = Partial<Pick<JobRow, "status" | "tx" | "result" | "error" | "batchIndex" | "attempts">>;

const MIGRATIONS = [
  `CREATE TABLE jobs (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
     account TEXT NOT NULL, ip TEXT NOT NULL, tx TEXT, result TEXT, error TEXT, gas TEXT, batch_index INTEGER,
     attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE INDEX jobs_status ON jobs (status, created_at);
   CREATE INDEX jobs_account ON jobs (kind, account, created_at);
   CREATE INDEX jobs_ip ON jobs (kind, ip, created_at);`,
];

type Raw = Record<string, unknown>;

const fromRow = (r: Raw): JobRow => ({
  id: String(r.id),
  kind: String(r.kind) as RelayerJobKind,
  status: String(r.status) as RelayerJobStatus,
  payload: String(r.payload),
  account: String(r.account),
  ip: String(r.ip),
  ...(r.tx ? { tx: String(r.tx) } : {}),
  ...(r.result ? { result: JSON.parse(String(r.result)) as JobRow["result"] } : {}),
  ...(r.error ? { error: JSON.parse(String(r.error)) as JobRow["error"] } : {}),
  ...(r.gas ? { gas: String(r.gas) } : {}),
  ...(r.batch_index !== null && r.batch_index !== undefined ? { batchIndex: Number(r.batch_index) } : {}),
  attempts: Number(r.attempts),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

/** The public shape of a job (docs/API.md). */
export const jobJson = (j: JobRow): RelayerJob => ({
  id: j.id,
  kind: j.kind,
  status: j.status,
  ...(j.tx ? { tx: j.tx as `0x${string}` } : {}),
  ...(j.result ? { result: j.result } : {}),
  ...(j.error ? { error: j.error } : {}),
});

export class JobStore {
  readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(path: string, now: () => number = Date.now) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.now = now;
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000");
    const v = Number((this.db.prepare("PRAGMA user_version").get() as Raw).user_version);
    for (let i = v; i < MIGRATIONS.length; i++) {
      this.db.exec("BEGIN");
      this.db.exec(MIGRATIONS[i]!);
      this.db.exec(`PRAGMA user_version = ${i + 1}`);
      this.db.exec("COMMIT");
    }
  }

  create(j: Omit<JobRow, "status" | "attempts" | "createdAt" | "updatedAt">): JobRow {
    const t = this.now();
    const row: JobRow = { ...j, status: "queued", attempts: 0, createdAt: t, updatedAt: t };
    this.db
      .prepare(
        "INSERT INTO jobs (id, kind, status, payload, account, ip, gas, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
      )
      .run(row.id, row.kind, row.status, row.payload, row.account, row.ip, row.gas ?? null, t, t);
    return row;
  }

  get(id: string): JobRow | undefined {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Raw | undefined;
    return r ? fromRow(r) : undefined;
  }

  update(id: string, p: JobPatch): void {
    const cols: [string, SQLInputValue][] = [["updated_at", this.now()]];
    if (p.status !== undefined) cols.push(["status", p.status]);
    if (p.tx !== undefined) cols.push(["tx", p.tx]);
    if (p.result !== undefined) cols.push(["result", JSON.stringify(p.result)]);
    if (p.error !== undefined) cols.push(["error", JSON.stringify(p.error)]);
    if (p.batchIndex !== undefined) cols.push(["batch_index", p.batchIndex]);
    if (p.attempts !== undefined) cols.push(["attempts", p.attempts]);
    this.db
      .prepare(`UPDATE jobs SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .run(...cols.map(([, v]) => v), id);
  }

  withStatus(status: RelayerJobStatus): JobRow[] {
    return (this.db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at, rowid").all(status) as Raw[]).map(fromRow);
  }

  /** Faucet grants (any status but failed) since `sinceMs`, optionally for one account or IP. */
  faucetGrants(sinceMs: number, by: { account?: string; ip?: string } = {}): number {
    let sql = "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'faucet' AND status != 'failed' AND created_at >= ?";
    const vals: SQLInputValue[] = [sinceMs];
    if (by.account !== undefined) {
      sql += " AND account = ?";
      vals.push(by.account);
    }
    if (by.ip !== undefined) {
      sql += " AND ip = ?";
      vals.push(by.ip);
    }
    return Number((this.db.prepare(sql).get(...vals) as Raw).n);
  }

  close(): void {
    this.db.close();
  }
}
