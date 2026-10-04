import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { DEPTH_CHUNK_TICKS, UnisonClient } from "../src/client.ts";
import type { Deployment } from "../src/types.ts";

const exchange = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as Address;
const gateway = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853" as Address;
const vault = "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1" as Address;
const ausd = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const me = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
const deployment: Deployment = { chainId: 31_337, exchange, gateway, markets: {} };

interface Call {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
}

/** Records reads/writes; `answer` decides what each read returns. */
function fakes(answer: (c: Call) => unknown) {
  const reads: Call[] = [];
  const writes: Call[] = [];
  const log: string[] = [];
  const publicClient = {
    readContract: async (c: Call) => {
      reads.push(c);
      log.push(`read ${c.functionName}`);
      return answer(c);
    },
    estimateContractGas: async () => 100_000n,
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      log.push(`wait ${hash}`);
      return { status: "success" };
    },
  };
  const walletClient = {
    account: { address: me, type: "json-rpc" },
    chain: undefined,
    writeContract: async (c: Call & { gas: bigint }) => {
      writes.push(c);
      log.push(`write ${c.functionName}`);
      expect(c.gas).toBe(112_000n); // estimate + 12% headroom
      return `0x${writes.length.toString(16).padStart(64, "0")}` as Hex;
    },
  };
  const client = new UnisonClient({ publicClient: publicClient as never, walletClient: walletClient as never, deployment });
  return { client, reads, writes, log };
}

describe("reads", () => {
  it("depthRange splits into ≤ 4,096-tick requests and stitches them in order", async () => {
    const { client, reads } = fakes((c) => {
      const [, , lo, hi] = c.args as [bigint, bigint, bigint, bigint];
      return Array.from({ length: Number(hi - lo + 1n) }, (_, i) => lo + BigInt(i)); // qty = tick
    });
    const lo = 10_000n;
    const hi = lo + 3n * DEPTH_CHUNK_TICKS + 99n;
    const d = await client.depthRange(0n, 1, lo, hi);
    expect(d).toHaveLength(Number(hi - lo + 1n));
    expect(d.every((q, i) => q === lo + BigInt(i))).toBe(true);
    expect(reads.map((r) => (r.args as bigint[]).slice(2))).toEqual([
      [lo, lo + 4_095n],
      [lo + 4_096n, lo + 8_191n],
      [lo + 8_192n, lo + 12_287n],
      [lo + 12_288n, hi],
    ]);
    for (const r of reads) expect((r.args as bigint[])[3]! - (r.args as bigint[])[2]!).toBeLessThanOrEqual(4_096n);
    expect(await client.depthRange(0n, 0, 5n, 4n)).toEqual([]);
    expect(await client.depthRange(0n, 0, 7n, 7n)).toEqual([7n]);
  });

  it("maps structs and tuples to typed objects", async () => {
    const { client, reads } = fakes((c) => {
      switch (c.functionName) {
        case "capsOf":
          return [{ tier: 1, day: 20_365n, traded: 5n, dailyCap: 100n }, 95n];
        case "marketPricing":
          return [10_000n, 10n ** 18n];
        case "curve":
          return { bidTop: 17_974, bidTicks: 5, bidPerTick: 7n, askBottom: 18_046, askTicks: 5, askPerTick: 0n };
        case "sessions":
          return [1_760_000_000n, 2n, 3n, 1n];
        case "passkeys":
          return [`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`];
        case "request":
          return { owner: me, redeem: true, time: 9n, amount: 10n };
        default:
          return 42n;
      }
    });
    expect(await client.capsOf(0n)).toEqual({ tier: 1, day: 20_365n, traded: 5n, dailyCap: 100n, remainingToday: 95n });
    expect(await client.marketPricing(0n)).toEqual({ tickSize: 10_000n, baseUnit: 10n ** 18n });
    expect(await client.vaultCurve(vault, 0n, 180_000_000n, 0, 18_000n, 17_820n, 18_180n)).toEqual({
      bidTop: 17_974n,
      bidTicks: 5n,
      bidPerTick: 7n,
      askBottom: 18_046n,
      askTicks: 5n,
      askPerTick: 0n,
    });
    expect(await client.sessions(me, ausd)).toEqual({ expiry: 1_760_000_000n, maxQty: 2n, maxNotional: 3n, marketMask: 1n });
    expect((await client.passkeys(me)).qy).toBe(`0x${"22".repeat(32)}`);
    expect(await client.vaultRequest(vault, 3n)).toEqual({ owner: me, redeem: true, time: 9n, amount: 10n });
    expect(await client.vaultShares(vault, me)).toBe(42n);
    expect(await client.bookTotal(0n, 1)).toBe(42n);
    await client.levelOf(0n, 0, 9, 18_000n);
    await client.tokens();
    const by = (fn: string) => reads.find((r) => r.functionName === fn)!;
    expect(by("sessions").address).toBe(gateway);
    expect(by("curve").address).toBe(vault);
    expect(by("curve").args).toEqual([0n, 180_000_000n, 0, 18_000n, 17_820n, 18_180n]);
    expect(by("bookTotal").args).toEqual([0n, 1n]);
    expect(by("levelOf").args).toEqual([0n, 0n, 9n, 18_000n]);
  });

  it("gateway reads need a gateway", async () => {
    const c = new UnisonClient({ publicClient: {} as never, deployment: { ...deployment, gateway: undefined } });
    await expect(c.sessions(me, me)).rejects.toThrow(/no gateway/);
  });
});

describe("writes", () => {
  it("requestDeposit approves the vault's quote token first, then queues the deposit", async () => {
    const { client, writes, log } = fakes((c) => (c.functionName === "quote" ? ausd : c.functionName === "allowance" ? 0n : 0n));
    await client.requestDeposit(vault, 1_000n);
    expect(writes.map((w) => [w.address, w.functionName, w.args])).toEqual([
      [ausd, "approve", [vault, 1_000n]],
      [vault, "requestDeposit", [1_000n]],
    ]);
    expect(log.indexOf("wait 0x" + "1".padStart(64, "0"))).toBeLessThan(log.indexOf("write requestDeposit"));
  });

  it("skips the approval when the allowance covers it; depositFor and requestRedeem", async () => {
    const { client, writes, reads } = fakes((c) => (c.functionName === "allowance" ? 10n ** 30n : ausd));
    await client.depositFor(gateway, ausd, 5n);
    await client.requestRedeem(vault, 7n);
    expect(writes.map((w) => [w.address, w.functionName, w.args])).toEqual([
      [exchange, "depositFor", [gateway, ausd, 5n]],
      [vault, "requestRedeem", [7n]],
    ]);
    expect(reads.find((r) => r.functionName === "allowance")!.args).toEqual([me, exchange]);
  });
});
