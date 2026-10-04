import { encodeAbiParameters, keccak256, type Hex } from "viem";

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

/**
 * The receipt hash exactly as `ExchangeClearing._finalize` computes it (and services/tape re-derives it):
 * keccak256(abi.encode(prev, marketId, upTo, tick, volume, refPrice, refTimeMs, status, block.timestamp)).
 * Each print commits to the one before it, so the tape is a hash chain anyone can re-walk.
 */
export function receiptHash(
  prev: Hex,
  p: { marketId: number; upTo: number; tick: number; volume: bigint; refPrice: bigint; refTimeMs: number; status: number },
  blockTimestamp: number,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint64" }, { type: "uint8" }, { type: "uint256" }],
      [prev, BigInt(p.marketId), BigInt(p.upTo), BigInt(p.tick), p.volume, p.refPrice, BigInt(p.refTimeMs), p.status, BigInt(blockTimestamp)],
    ),
  );
}
