/**
 * Reads without viem, for pages that watch more than they sign: resting depth and ledger balances as plain
 * JSON-RPC `eth_call`s, ABI-encoded by hand. Both calls take static words and return a uint256 or a uint256[],
 * so the encoding is a few lines; `test/light.test.ts` checks the selectors and every encoding against viem and
 * the generated ABI. A browser that only shows the book never downloads a contract toolkit.
 *
 *   const reader = new LightReader(rpcUrl, deployment.exchange);
 *   const bids = await reader.depthRange(1n, Side.BID, refTick - 40n, refTick + 40n);   // index i = tick lo + i
 */
import type { Address, Hex } from "viem";
import type { SideCode } from "./types.ts";

/** `depth(uint256 marketId, uint256 side, uint256 lo, uint256 hi) → uint256[]` */
export const DEPTH_SELECTOR = "0x2ad6ca64";
/** `balanceOf(address account, address token) → uint256`: the venue ledger, not an ERC-20 */
export const BALANCE_OF_SELECTOR = "0xf7888aec";
/**
 * `curve(uint256 marketId, uint256 refPrice, uint8 status, uint256 refTick, uint256 lo, uint256 hi)` on a curve source
 * (the LiquidityVault): its quote for one auction, before the venue caps it by the source's ledger balances.
 */
export const CURVE_SELECTOR = "0x0b9606a8";
/**
 * `read(uint256 marketId, uint256 batch, bytes payload)` on a reference adapter: the price an auction would clear
 * against now. Push feeds (Chainlink) take an empty payload; it is the read the venue makes when it clears.
 */
export const READ_SELECTOR = "0xf273ee0a";
/** Ticks per `depth` call: the contract accepts at most hi - lo = 4,096. */
const CHUNK = 4_096n;
const MAX = (1n << 256n) - 1n;

const word = (n: bigint) => {
  if (n < 0n || n > MAX) throw new RangeError(`not a uint256: ${n}`);
  return n.toString(16).padStart(64, "0");
};
const addressWord = (a: string) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new TypeError(`not an address: ${a}`);
  return a.slice(2).toLowerCase().padStart(64, "0");
};

export const encodeDepthCall = (marketId: bigint, side: SideCode, lo: bigint, hi: bigint): Hex =>
  `${DEPTH_SELECTOR}${word(marketId)}${word(BigInt(side))}${word(lo)}${word(hi)}`;

export const encodeBalanceOfCall = (account: Address, token: Address): Hex => `${BALANCE_OF_SELECTOR}${addressWord(account)}${addressWord(token)}`;

export const encodeCurveCall = (marketId: bigint, refPrice: bigint, status: number, refTick: bigint, lo: bigint, hi: bigint): Hex =>
  `${CURVE_SELECTOR}${word(marketId)}${word(refPrice)}${word(BigInt(status))}${word(refTick)}${word(lo)}${word(hi)}`;

/** The reference read with an empty payload (offset 0x60, length 0). */
export const encodeReadCall = (marketId: bigint, batch = 0n): Hex => `${READ_SELECTOR}${word(marketId)}${word(batch)}${word(0x60n)}${word(0n)}`;

/** Return data → (price in quote units per whole token, publish time in ms, IReferenceAdapter.Status). */
export function decodeRead(data: Hex): { price: bigint; publishTimeMs: bigint; status: number } {
  const h = data.slice(2);
  if (h.length < 3 * 64) throw new Error(`short return data for read: ${data}`);
  const w = (i: number) => BigInt(`0x${h.slice(i * 64, (i + 1) * 64)}`);
  return { price: w(0), publishTimeMs: w(1), status: Number(w(2)) };
}

/** ICurveSource.Curve: bids from `bidTop` down and asks from `askBottom` up, `perTick` base units at each tick. */
export interface CurveQuote {
  bidTop: number;
  bidTicks: number;
  bidPerTick: bigint;
  askBottom: number;
  askTicks: number;
  askPerTick: bigint;
}

/** Return data → Curve (six static words). */
export function decodeCurve(data: Hex): CurveQuote {
  const h = data.slice(2);
  if (h.length < 6 * 64) throw new Error(`short return data for Curve: ${data}`);
  const w = (i: number) => BigInt(`0x${h.slice(i * 64, (i + 1) * 64)}`);
  return { bidTop: Number(w(0)), bidTicks: Number(w(1)), bidPerTick: w(2), askBottom: Number(w(3)), askTicks: Number(w(4)), askPerTick: w(5) };
}

/** Return data → uint256. */
export function decodeUint(data: Hex): bigint {
  if (data.length < 66) throw new Error(`short return data: ${data}`);
  return BigInt(data.slice(0, 66));
}

/** Return data → uint256[] (one dynamic array: an offset, a length, then the words). */
export function decodeUintArray(data: Hex): bigint[] {
  const h = data.slice(2);
  const at = Number(BigInt(`0x${h.slice(0, 64) || "0"}`)) * 2;
  const length = Number(BigInt(`0x${h.slice(at, at + 64) || "0"}`));
  if (h.length < at + 64 + length * 64) throw new Error("short return data for uint256[]");
  const out = new Array<bigint>(length);
  for (let i = 0; i < length; i++) out[i] = BigInt(`0x${h.slice(at + 64 + i * 64, at + 128 + i * 64)}`);
  return out;
}

export class LightReader {
  readonly rpcUrl: string;
  readonly exchange: Address;
  private readonly fetchImpl: typeof fetch;
  private id = 0;

  constructor(rpcUrl: string, exchange: Address, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.rpcUrl = rpcUrl;
    this.exchange = exchange;
    this.fetchImpl = fetchImpl;
  }

  private async call(data: Hex, to: Address = this.exchange): Promise<Hex> {
    const res = await this.fetchImpl(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method: "eth_call", params: [{ to, data }, "latest"] }),
    });
    if (!res.ok) throw new Error(`eth_call failed: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: Hex; error?: { message?: string } };
    if (body.error || typeof body.result !== "string") throw new Error(`eth_call failed: ${body.error?.message ?? "no result"}`);
    return body.result;
  }

  /** Resting quantity per tick, lo..hi inclusive (at most 4,096 ticks). */
  async depth(marketId: bigint, side: SideCode, lo: bigint, hi: bigint): Promise<bigint[]> {
    return decodeUintArray(await this.call(encodeDepthCall(marketId, side, lo, hi)));
  }

  /** `depth` over any range: chunks of at most 4,096 ticks, in parallel, concatenated (index i = tick lo + i). */
  async depthRange(marketId: bigint, side: SideCode, lo: bigint, hi: bigint): Promise<bigint[]> {
    if (hi < lo) return [];
    const parts: Promise<bigint[]>[] = [];
    for (let a = lo; a <= hi; a += CHUNK) parts.push(this.depth(marketId, side, a, a + CHUNK - 1n < hi ? a + CHUNK - 1n : hi));
    return (await Promise.all(parts)).flat();
  }

  /** The reference an auction would clear against if it cleared now, from a push-feed adapter (Chainlink). */
  async reference(adapter: Address, marketId: bigint): Promise<{ price: bigint; publishTimeMs: bigint; status: number }> {
    return decodeRead(await this.call(encodeReadCall(marketId), adapter));
  }

  /** A curve source's quote for one auction (call it with the reference the next auction would use). */
  async curve(source: Address, marketId: bigint, refPrice: bigint, status: number, refTick: bigint, lo: bigint, hi: bigint): Promise<CurveQuote> {
    return decodeCurve(await this.call(encodeCurveCall(marketId, refPrice, status, refTick, lo, hi), source));
  }

  /** An account's free balance on the venue ledger. */
  async balanceOf(account: Address, token: Address): Promise<bigint> {
    return decodeUint(await this.call(encodeBalanceOfCall(account, token)));
  }
}
