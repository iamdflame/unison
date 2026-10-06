import { describe, expect, it } from "vitest";
import { decodeAbiParameters, hexToString } from "viem";
import {
  capFromAdv,
  deviationBps,
  encodeAudit,
  encodeCaps,
  encodeHalt,
  haltDecisions,
  KIND_AUDIT,
  KIND_CAPS,
  KIND_HALT,
  median,
  parseNasdaqHalts,
  pick,
  sentinelDecision,
  toQuoteUnits,
} from "../src/logic.ts";

const unwrap = (hex: `0x${string}`) => decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], hex);

describe("reference audit", () => {
  it("medians across sources and measures deviation like the receiver", () => {
    expect(median([181, 179, 180])).toBe(180);
    expect(median([179, 181])).toBe(180);
    const consensus = toQuoteUnits(176);
    expect(consensus).toBe(176_000_000n);
    expect(deviationBps(180_000_000n, consensus)).toBe(227n); // receiver halts above its threshold
    expect(deviationBps(180_500_000n, 180_000_000n)).toBe(27n);
  });

  it("encodes the receiver's AUDIT report", () => {
    const [kind, data] = unwrap(encodeAudit(3n, 176_000_000n, 1_760_000_001_000n, 2));
    expect(kind).toBe(KIND_AUDIT);
    const [id, audited, ms, signer] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint64" }, { type: "uint8" }],
      data,
    );
    expect([id, audited, ms, signer]).toEqual([3n, 176_000_000n, 1_760_000_001_000n, 2]);
  });

  it("reads nested JSON paths from market-data APIs", () => {
    expect(pick({ trade: { p: 180.12 } }, "trade.p")).toBe(180.12);
    expect(pick({ bars: [{ v: 7 }] }, "bars.0.v")).toBe(7);
    expect(pick({}, "a.b")).toBeUndefined();
  });
});

describe("daily volume caps", () => {
  it("is ADV × tier bps in base units (0.25% tier 1, 2.5% tier 2)", () => {
    expect(capFromAdv(180_000_000, 1, 18)).toBe(450_000n * 10n ** 18n);
    expect(capFromAdv(80_000_000, 2, 18)).toBe(2_000_000n * 10n ** 18n);
    const [kind, data] = unwrap(encodeCaps([0n, 1n], [5n, 7n]));
    expect(kind).toBe(KIND_CAPS);
    const [ids, caps] = decodeAbiParameters([{ type: "uint256[]" }, { type: "uint128[]" }], data);
    expect(ids).toEqual([0n, 1n]);
    expect(caps).toEqual([5n, 7n]);
  });
});

describe("halt mirroring", () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>NVDA</title><ndaq:IssueSymbol>NVDA</ndaq:IssueSymbol><ndaq:ReasonCode>LUDP</ndaq:ReasonCode>
      <ndaq:ResumptionTradeTime></ndaq:ResumptionTradeTime></item>
    <item><title>TSLA</title><ndaq:IssueSymbol>TSLA</ndaq:IssueSymbol><ndaq:ReasonCode>T1</ndaq:ReasonCode>
      <ndaq:ResumptionTradeTime>10:20:30</ndaq:ResumptionTradeTime></item>
    <item><title>NVDA</title><ndaq:IssueSymbol>NVDA</ndaq:IssueSymbol><ndaq:ReasonCode>T1</ndaq:ReasonCode>
      <ndaq:ResumptionTradeTime>09:45:00</ndaq:ResumptionTradeTime></item>
  </channel></rss>`;

  it("parses the newest item per symbol", () => {
    const h = parseNasdaqHalts(rss);
    expect(h.get("NVDA")).toEqual({ symbol: "NVDA", reason: "LUDP", active: true });
    expect(h.get("TSLA")?.active).toBe(false);
  });

  it("emits only state changes (halt NVDA, resume TSLA, leave SPY)", () => {
    const markets = [
      { marketId: 0, symbol: "NVDA" },
      { marketId: 4, symbol: "TSLA" },
      { marketId: 1, symbol: "SPY" },
    ];
    const onchain = new Map([
      [0, false],
      [4, true],
      [1, false],
    ]);
    const actions = haltDecisions(parseNasdaqHalts(rss), markets, onchain);
    expect(actions).toEqual([
      { marketId: 0n, halted: true, reason: "LUDP" },
      { marketId: 4n, halted: false, reason: "resumed" },
    ]);
    const [kind, data] = unwrap(encodeHalt(0n, true, "LUDP"));
    expect(kind).toBe(KIND_HALT);
    const [, halted, reason] = decodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "bytes32" }], data);
    expect(halted).toBe(true);
    expect(hexToString(reason, { size: 32 })).toBe("LUDP");
  });
});

describe("feed sentinel (causal mainnet)", () => {
  const base = { feedPrice: 28_994n, maxDeviationBps: 75, maxSilentSec: 120 };
  it("leaves a healthy feed alone, even far from the exchanges while an observation is in flight", () => {
    // MON jumped 1.5% on the exchanges; Chainlink observed 8 s ago and its next report is still landing
    const d = sentinelDecision({ ...base, observedAt: 1_000n, now: 1_008n, consensus: 29_430n });
    expect(d.dev).toBe(148n);
    expect(d.halt).toBe(false);
  });
  it("leaves a quiet feed alone while it agrees with the exchanges (MON can sit inside 2 bp for an hour)", () => {
    expect(sentinelDecision({ ...base, observedAt: 1_000n, now: 4_000n, consensus: 29_000n }).halt).toBe(false);
  });
  it("halts when the feed is both far off and silent: a stuck or broken feed", () => {
    const d = sentinelDecision({ ...base, observedAt: 1_000n, now: 1_300n, consensus: 29_430n });
    expect(d).toEqual({ dev: 148n, silentSec: 300n, halt: true });
  });
  it("never counts a future observation as silence", () => {
    expect(sentinelDecision({ ...base, observedAt: 2_000n, now: 1_000n, consensus: 40_000n }).silentSec).toBe(0n);
  });
});
