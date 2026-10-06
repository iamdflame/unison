import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeFunctionData, toFunctionSelector, type Address, type Hex } from "viem";
import { liquidityVaultAbi } from "../src/abis/LiquidityVault.ts";
import { unisonExchangeAbi } from "../src/abis/UnisonExchange.ts";
import { chainlinkCausalReferenceAbi } from "../src/abis/ChainlinkCausalReference.ts";
import {
  BALANCE_OF_SELECTOR,
  CURVE_SELECTOR,
  decodeCurve,
  decodeRead,
  encodeReadCall,
  READ_SELECTOR,
  FEEDS_SELECTOR,
  encodeFeedsCall,
  decodeFeeds,
  decodeUint,
  decodeUintArray,
  DEPTH_SELECTOR,
  encodeBalanceOfCall,
  encodeCurveCall,
  encodeDepthCall,
  LightReader,
} from "../src/light.ts";
import { Side } from "../src/types.ts";

const exchange = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as Address;
const me = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
const ausd = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;

describe("light reads match the ABI", () => {
  it("reads a reference adapter exactly as viem encodes and decodes it", () => {
    const abi = [{ type: "function", name: "read", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint8" }] }] as const;
    expect(READ_SELECTOR).toBe(toFunctionSelector("read(uint256,uint256,bytes)"));
    expect(FEEDS_SELECTOR).toBe(toFunctionSelector("feeds(uint256)"));
    expect(encodeFeedsCall(7n)).toBe(
      encodeFunctionData({ abi: chainlinkCausalReferenceAbi, functionName: "feeds", args: [7n] }),
    );
    const base = "0xbcd78f76005b7515837af6b50c7c52bcf73822fb";
    const quote = "0xe20751c7b5867bcbef815ffc1b284c3f412a9e13";
    const feedsRet = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint8" }, { type: "uint8" }, { type: "uint8" }, { type: "uint32" }, { type: "uint32" }, { type: "uint32" }, { type: "uint32" }, { type: "uint16" }, { type: "bool" }],
      [base, quote, 8, 8, 6, 3_900, 3_900, 0, 0, 50, true],
    );
    expect(decodeFeeds(feedsRet)).toEqual({ base, quote });
    expect(encodeReadCall(0n)).toBe(encodeFunctionData({ abi, functionName: "read", args: [0n, 0n, "0x"] }));
    expect(encodeReadCall(7n, 110_850_455n)).toBe(encodeFunctionData({ abi, functionName: "read", args: [7n, 110_850_455n, "0x"] }));
    const ret = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint8" }], [240_619_370n, 1_791_233_102_000n, 2]);
    expect(decodeRead(ret)).toEqual({ price: 240_619_370n, publishTimeMs: 1_791_233_102_000n, status: 2 });
  });

  it("reads the vault's curve exactly as viem encodes and decodes it", () => {
    expect(CURVE_SELECTOR).toBe(toFunctionSelector("curve(uint256,uint256,uint8,uint256,uint256,uint256)"));
    expect(encodeCurveCall(0n, 235_556_604n, 2, 23_555n, 23_321n, 23_791n)).toBe(
      encodeFunctionData({ abi: liquidityVaultAbi, functionName: "curve", args: [0n, 235_556_604n, 2, 23_555n, 23_321n, 23_791n] }),
    );
    const ret = encodeAbiParameters(
      [{ type: "tuple", components: ["uint32", "uint32", "uint128", "uint32", "uint32", "uint128"].map((type, i) => ({ type, name: `f${i}` })) }],
      [{ f0: 23_531, f1: 10, f2: 6_793_781_082_019_670n, f3: 23_579, f4: 10, f5: 6_793_781_082_019_670n }],
    );
    expect(decodeCurve(ret)).toEqual({ bidTop: 23_531, bidTicks: 10, bidPerTick: 6_793_781_082_019_670n, askBottom: 23_579, askTicks: 10, askPerTick: 6_793_781_082_019_670n });
  });

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

  it("reads a block's timestamp, and refuses a block the node doesn't have", async () => {
    const seen: unknown[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body)) as { id: number; method: string; params: [string, boolean] };
      seen.push(req.params);
      expect(req.method).toBe("eth_getBlockByNumber");
      const result = req.params[0] === "0x69c4b1e" ? { number: req.params[0], timestamp: "0x68e3a1f5" } : null;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }));
    }) as typeof fetch;
    const reader = new LightReader("http://rpc.test", exchange, fetchImpl);
    expect(await reader.blockTime(110_906_142n)).toBe(0x68e3a1f5);
    expect(seen[0]).toEqual(["0x69c4b1e", false]);
    await expect(reader.blockTime(1n)).rejects.toThrow("no result");
  });
});
