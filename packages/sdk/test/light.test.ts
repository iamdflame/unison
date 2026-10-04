import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeFunctionData, toFunctionSelector, type Address, type Hex } from "viem";
import { unisonExchangeAbi } from "../src/abis/UnisonExchange.ts";
import {
  BALANCE_OF_SELECTOR,
  decodeUint,
  decodeUintArray,
  DEPTH_SELECTOR,
  encodeBalanceOfCall,
  encodeDepthCall,
  LightReader,
} from "../src/light.ts";
import { Side } from "../src/types.ts";

const exchange = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as Address;
const me = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
const ausd = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;

describe("light reads match the ABI", () => {
  it("has the exchange's selectors", () => {
    expect(DEPTH_SELECTOR).toBe(toFunctionSelector("depth(uint256,uint256,uint256,uint256)"));
    expect(BALANCE_OF_SELECTOR).toBe(toFunctionSelector("balanceOf(address,address)"));
    // and the generated ABI still has those signatures
    const fns = unisonExchangeAbi.filter((x) => x.type === "function").map((f) => `${f.name}(${f.inputs.map((i) => i.type).join(",")})`);
    expect(fns).toContain("depth(uint256,uint256,uint256,uint256)");
    expect(fns).toContain("balanceOf(address,address)");
  });

  it("encodes depth exactly as viem does", () => {
    for (const [m, side, lo, hi] of [
      [1n, Side.BID, 0n, 4_095n],
      [9n, Side.ASK, 17_960n, 18_040n],
      [(1n << 255n) + 7n, Side.ASK, 1n, (1n << 256n) - 1n],
    ] as const) {
      expect(encodeDepthCall(m, side, lo, hi)).toBe(encodeFunctionData({ abi: unisonExchangeAbi, functionName: "depth", args: [m, BigInt(side), lo, hi] }));
    }
  });

  it("encodes balanceOf exactly as viem does, whatever the address case", () => {
    expect(encodeBalanceOfCall(me, ausd)).toBe(encodeFunctionData({ abi: unisonExchangeAbi, functionName: "balanceOf", args: [me, ausd] }));
    expect(encodeBalanceOfCall(me.toLowerCase() as Address, ausd)).toBe(encodeBalanceOfCall(me, ausd));
  });

  it("refuses what is not a uint256 or an address", () => {
    expect(() => encodeDepthCall(1n, Side.BID, -1n, 4n)).toThrow(RangeError);
    expect(() => encodeDepthCall(1n, Side.BID, 0n, 1n << 256n)).toThrow(RangeError);
    expect(() => encodeBalanceOfCall("0x1234" as Address, ausd)).toThrow(TypeError);
  });

  it("decodes return data as viem encodes it", () => {
    for (const xs of [[], [0n], [1n, 0n, 250_000_000n, (1n << 256n) - 1n], Array.from({ length: 81 }, (_, i) => BigInt(i * i))]) {
      expect(decodeUintArray(encodeAbiParameters([{ type: "uint256[]" }], [xs]))).toEqual(xs);
    }
    expect(decodeUint(encodeAbiParameters([{ type: "uint256" }], [123_456_789n]))).toBe(123_456_789n);
    expect(() => decodeUint("0x12")).toThrow();
    expect(() => decodeUintArray(`0x${"20".padStart(64, "0")}${"03".padStart(64, "0")}` as Hex)).toThrow();
  });
});

describe("LightReader", () => {
  /** A JSON-RPC endpoint that answers each eth_call through `answer`, recording the calls. */
  function rpc(answer: (data: Hex) => Hex | { error: string }) {
    const calls: { to: string; data: Hex; block: string }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body)) as { id: number; method: string; params: [{ to: string; data: Hex }, string] };
      expect(req.method).toBe("eth_call");
      calls.push({ ...req.params[0], block: req.params[1] });
      const a = answer(req.params[0].data);
      return new Response(JSON.stringify(typeof a === "string" ? { jsonrpc: "2.0", id: req.id, result: a } : { jsonrpc: "2.0", id: req.id, error: { code: 3, message: a.error } }));
    }) as typeof fetch;
    return { calls, reader: new LightReader("http://rpc.test", exchange, fetchImpl) };
  }

  it("reads depth in chunks of 4,096 ticks, in order", async () => {
    const { calls, reader } = rpc((data) => {
      const lo = BigInt(`0x${data.slice(10 + 128, 10 + 192)}`);
      const hi = BigInt(`0x${data.slice(10 + 192, 10 + 256)}`);
      return encodeAbiParameters([{ type: "uint256[]" }], [Array.from({ length: Number(hi - lo + 1n) }, (_, i) => lo + BigInt(i))]);
    });
    const out = await reader.depthRange(3n, Side.ASK, 10n, 10n + 5_000n);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.to === exchange && c.block === "latest")).toBe(true);
    expect(out).toHaveLength(5_001);
    expect(out[0]).toBe(10n);
    expect(out.at(-1)).toBe(5_010n);
    expect(await reader.depthRange(3n, Side.ASK, 5n, 4n)).toEqual([]);
  });

  it("reads a ledger balance", async () => {
    const { calls, reader } = rpc(() => encodeAbiParameters([{ type: "uint256" }], [42_000_000n]));
    expect(await reader.balanceOf(me, ausd)).toBe(42_000_000n);
    expect(calls[0]!.data).toBe(encodeBalanceOfCall(me, ausd));
  });

  it("surfaces a JSON-RPC error", async () => {
    const { reader } = rpc(() => ({ error: "execution reverted" }));
    await expect(reader.balanceOf(me, ausd)).rejects.toThrow("execution reverted");
  });
});
