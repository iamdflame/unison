/**
 * Pure decision logic shared by the Unison CRE workflows (no SDK imports → unit-testable in Node, and safe to
 * bundle into the WASM workflows). Report encodings match contracts/src/audit/CREAuditReceiver.sol.
 */
import { encodeAbiParameters, stringToHex, type Hex } from "viem";

export const KIND_AUDIT = 1;
export const KIND_CAPS = 2;
export const KIND_HALT = 3;

/** Volume cap per LULD tier as basis points of ADV (SEC Release 34-106402: 0.25% tier 1, 2.5% tier 2). */
export const TIER_CAP_BPS: Record<1 | 2, bigint> = { 1: 25n, 2: 250n };

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of nothing");
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** |reference − observed| / observed in basis points (rounded down). */
export function deviationBps(reference: bigint, observed: bigint): bigint {
  if (observed <= 0n) return 2n ** 64n;
  const d = reference > observed ? reference - observed : observed - reference;
  return (d * 10_000n) / observed;
}

/** Decimal price → integer quote units (AUSD: 6 decimals). */
export function toQuoteUnits(price: number, decimals = 6): bigint {
  return BigInt(Math.round(price * 10 ** decimals));
}

/** Reads `a.b.c` / `bars.0.v` style paths out of parsed JSON. */
export function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const wrap = (kind: number, data: Hex): Hex => encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [kind, data]);

export function encodeAudit(marketId: bigint, audited: bigint, operatorPublishMs: bigint, signerId: number): Hex {
  return wrap(
    KIND_AUDIT,
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint64" }, { type: "uint8" }],
      [marketId, audited, operatorPublishMs, signerId],
    ),
  );
}

/** Daily cap in base units = ADV (shares) × tier bps, scaled to the token's decimals. */
export function capFromAdv(advShares: number, tier: 1 | 2, baseDecimals: number): bigint {
  const shares = BigInt(Math.floor(advShares));
  return (shares * 10n ** BigInt(baseDecimals) * TIER_CAP_BPS[tier]) / 10_000n;
}

export function encodeCaps(marketIds: readonly bigint[], caps: readonly bigint[]): Hex {
  return wrap(KIND_CAPS, encodeAbiParameters([{ type: "uint256[]" }, { type: "uint128[]" }], [marketIds, caps]));
}

export function encodeHalt(marketId: bigint, halted: boolean, reason: string): Hex {
  return wrap(
    KIND_HALT,
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }, { type: "bytes32" }],
      [marketId, halted, stringToHex(reason.slice(0, 31), { size: 32 })],
    ),
  );
}

export interface HaltRecord {
  symbol: string;
  reason: string;
  active: boolean; // no resumption trade time yet
}

/**
 * Parses the Nasdaq Trader trade-halts RSS (nasdaqtrader.com/rss.aspx?feed=tradehalts). Items are newest
 * first; the newest item per symbol decides. A halt is active until it has a ResumptionTradeTime.
 */
export function parseNasdaqHalts(xml: string): Map<string, HaltRecord> {
  const out = new Map<string, HaltRecord>();
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<ndaq:${name}>([^<]*)</ndaq:${name}>`));
    return m ? m[1]!.trim() : "";
  };
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1]!;
    const symbol = tag(block, "IssueSymbol");
    if (!symbol || out.has(symbol)) continue;
    out.set(symbol, { symbol, reason: tag(block, "ReasonCode"), active: tag(block, "ResumptionTradeTime") === "" });
  }
  return out;
}

export interface HaltAction {
  marketId: bigint;
  halted: boolean;
  reason: string;
}

/** State changes only: halt markets whose primary is halted, lift halts that the primary resumed. */
export function haltDecisions(
  halts: Map<string, HaltRecord>,
  markets: readonly { marketId: number; symbol: string }[],
  onchainHalted: ReadonlyMap<number, boolean>,
): HaltAction[] {
  const out: HaltAction[] = [];
  for (const m of markets) {
    const h = halts.get(m.symbol);
    const want = h?.active ?? false;
    const now = onchainHalted.get(m.marketId) ?? false;
    if (want !== now) out.push({ marketId: BigInt(m.marketId), halted: want, reason: want ? h!.reason : "resumed" });
  }
  return out;
}
