import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteTapeStore, type ClaimRow, type PrintRow } from "../src/db.ts";

const print = (block: number, logIndex: number, over: Partial<PrintRow> = {}): PrintRow => ({
  block,
  logIndex,
  tx: `0x${"ab".repeat(32)}`,
  ts: 1_760_000_000_000 + block * 1000,
  marketId: 0,
  upTo: block - 1,
  tick: 18_000,
  price: "180000000",
  volume: "123456789012345678901234567890", // > 2^64: must round-trip as TEXT
  refPrice: "180010000",
  refTimeMs: 1_760_000_000_400,
  status: 0,
  bandLo: 17_820,
  bandHi: 18_180,
  receiptHash: `0x${"01".repeat(32)}`,
  prevReceiptHash: `0x${"00".repeat(32)}`,
  chainOk: true,
  regime: "LIVE",
  deviationBps: -0.55,
  closeTs: null,
  ...over,
});

const claim = (block: number, logIndex: number, tx: string): ClaimRow => ({
  block,
  logIndex,
  tx,
  ts: 0,
  marketId: 0,
  account: "0xabc",
  slot: 3,
  side: 0,
  baseAmount: "5",
  quoteAmount: "0",
  fee: "0",
  done: false,
});

describe("SqliteTapeStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("opens in WAL mode, migrates once and reopens without re-running migrations", () => {
    const dir = mkdtempSync(join(tmpdir(), "tape-"));
    dirs.push(dir);
    const path = join(dir, "nested", "tape.db");
    const a = new SqliteTapeStore(path);
    expect((a.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    a.insert({ table: "prints", row: print(10, 0) });
    a.setMeta("indexed", "42");
    a.close();
    const b = new SqliteTapeStore(path);
    expect((b.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
    expect(b.getMeta("indexed")).toBe("42");
    expect(b.printCount(0)).toBe(1);
    b.close();
  });

  it("is idempotent per (block, logIndex) and keeps bigints exact", () => {
    const s = new SqliteTapeStore(":memory:");
    expect(s.insert({ table: "prints", row: print(10, 0) })).toBe(true);
    expect(s.insert({ table: "prints", row: print(10, 0) })).toBe(false);
    expect(s.printCount(0)).toBe(1);
    const row = s.print(10, 0)!;
    expect(row.volume).toBe("123456789012345678901234567890");
    expect(row.chainOk).toBe(true);
    expect(row.deviationBps).toBe(-0.55);
    expect(row.closeTs).toBeNull();
  });

  it("replaces a different log found at the same position (reorg), whichever table it was in", () => {
    const s = new SqliteTapeStore(":memory:");
    s.insert({ table: "prints", row: print(10, 0) });
    expect(s.insert({ table: "claims", row: claim(10, 0, `0x${"cd".repeat(32)}`) })).toBe(true);
    expect(s.printCount(0)).toBe(0);
    expect(s.claims("0xabc")).toHaveLength(1);
  });

  it("retracts only the log it was asked to (tx guard)", () => {
    const s = new SqliteTapeStore(":memory:");
    s.insert({ table: "claims", row: claim(7, 2, `0x${"cd".repeat(32)}`) });
    expect(s.retract(7, 2, `0x${"ef".repeat(32)}`)).toBeUndefined();
    const gone = s.retract(7, 2, `0x${"CD".repeat(32)}`);
    expect(gone?.table).toBe("claims");
    expect(s.claims("0xabc")).toHaveLength(0);
    expect(s.retract(7, 2)).toBeUndefined();
  });

  it("orders prints in chain order and filters them", () => {
    const s = new SqliteTapeStore(":memory:");
    s.insert({ table: "prints", row: print(10, 1) });
    s.insert({ table: "prints", row: print(10, 0, { volume: "0" }) });
    s.insert({ table: "prints", row: print(12, 0) });
    expect(s.prints(0).map((p) => [p.block, p.logIndex])).toEqual([
      [12, 0],
      [10, 1],
      [10, 0],
    ]);
    expect(s.prints(0, { traded: true, asc: true }).map((p) => [p.block, p.logIndex])).toEqual([
      [10, 1],
      [12, 0],
    ]);
    expect(s.prints(0, { before: 11 })).toHaveLength(2);
    expect(s.printBefore(0, 12, 0)).toMatchObject({ block: 10, logIndex: 1 });
    expect(s.printsAfter(0, 10, 0).map((p) => p.block)).toEqual([10, 12]);
    expect(s.lastPrint(0, true)).toMatchObject({ block: 12 });
  });

  it("rolls a failed transaction back", () => {
    const s = new SqliteTapeStore(":memory:");
    expect(() =>
      s.transaction(() => {
        s.insert({ table: "prints", row: print(10, 0) });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(s.printCount(0)).toBe(0);
  });

  it("stores vault snapshots by time", () => {
    const s = new SqliteTapeStore(":memory:");
    for (const t of [3_000, 1_000, 2_000]) {
      s.putVaultSnapshot({ vault: "0xv", t, block: t, nav: "1", supply: "1", base: "0", quote: "1", spreadPnl: "-1", inventoryPnl: "2", decimals: 12 });
    }
    expect(s.vaultSnapshots("0xv", 1_500).map((x) => x.t)).toEqual([2_000, 3_000]);
  });
});
