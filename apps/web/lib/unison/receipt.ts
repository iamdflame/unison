import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import type { Hex } from "viem";

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

const MAX = (1n << 256n) - 1n;
const word = (n: bigint) => {
  if (n < 0n || n > MAX) throw new RangeError(`not a uint256: ${n}`);
  return n.toString(16).padStart(64, "0");
};

/**
 * The receipt hash exactly as `ExchangeClearing._finalize` computes it (and services/tape re-derives it):
 * keccak256(abi.encode(prev, marketId, upTo, tick, volume, refPrice, refTimeMs, status, block.timestamp)).
 * Each print commits to the one before it, so the tape is a hash chain anyone can re-walk. Every field is one
 * static word, so the encoding is nine words side by side (test/receipt.test.ts checks it against viem).
 */
export function receiptHash(
  prev: Hex,
  p: { marketId: number; upTo: number; tick: number; volume: bigint; refPrice: bigint; refTimeMs: number; status: number },
  blockTimestamp: number,
): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(prev)) throw new TypeError(`not a bytes32: ${prev}`);
  const words =
    prev.slice(2) +
    [p.marketId, p.upTo, p.tick, p.volume, p.refPrice, p.refTimeMs, p.status, blockTimestamp].map((v) => word(BigInt(v))).join("");
  return `0x${bytesToHex(keccak_256(hexToBytes(words)))}`;
}
