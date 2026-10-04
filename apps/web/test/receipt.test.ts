import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { receiptHash, ZERO_HASH } from "../lib/unison/receipt.ts";

/** The contract's encoding, through viem: the reference the hand-rolled hash must match. */
const reference = (prev: Hex, p: Parameters<typeof receiptHash>[1], ts: number) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint64" }, { type: "uint8" }, { type: "uint256" }],
      [prev, BigInt(p.marketId), BigInt(p.upTo), BigInt(p.tick), p.volume, p.refPrice, BigInt(p.refTimeMs), p.status, BigInt(ts)],
    ),
  );

describe("receiptHash", () => {
  it("matches abi.encode + keccak256 along a chain of prints", () => {
    let prev = ZERO_HASH;
    for (let i = 0; i < 40; i++) {
      const p = {
        marketId: 1 + (i % 10),
        upTo: 1_000_000 + i * 3,
        tick: 18_000 + ((i * 37) % 200),
        volume: BigInt(i) * 10n ** 18n + 123n,
        refPrice: BigInt(180_000_000 + i * 1_000),
        refTimeMs: 1_790_000_000_000 + i * 300,
        status: i % 4,
      };
      const ts = 1_790_000_000 + i;
      const h = receiptHash(prev, p, ts);
      expect(h).toBe(reference(prev, p, ts));
      prev = h;
    }
  });

  it("refuses a malformed link or a negative field", () => {
    const p = { marketId: 1, upTo: 1, tick: 1, volume: 1n, refPrice: 1n, refTimeMs: 1, status: 0 };
    expect(() => receiptHash("0x1234" as Hex, p, 1)).toThrow(TypeError);
    expect(() => receiptHash(ZERO_HASH, { ...p, tick: -1 }, 1)).toThrow(RangeError);
  });
});
