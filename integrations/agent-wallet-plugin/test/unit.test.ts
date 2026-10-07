import { encodeErrorResult, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { unisonExchangeAbi } from "@unison/sdk/abis/index.ts";
import { latencyChallengeAbi } from "@unison/sdk/abis/index.ts";
import { explainRevert, UnisonError } from "../src/lib/chain.ts";
import { selectedEvmAddress } from "../src/lib/host-state.ts";
import type { MarketState } from "../src/lib/markets.ts";
import { resolveClearTx } from "../src/lib/receipt.ts";
import { findClaim, planOrder } from "../src/lib/trading.ts";
import { buyLock, fromUnits, tickAtOrAbove, tickAtOrBelow, toUnits } from "../src/lib/units.ts";
import { marketByName, markets, tokenByName } from "../src/lib/venue.ts";

const wmon = marketByName("WMON")!;
/** WMON/AUSD as the chain had it on 6 October 2026: a tick of 0.000001 AUSD, 3 bp fees (10 bp at most). */
const state = (over: Partial<MarketState> = {}): MarketState => ({
  market: wmon,
  active: true,
  halted: false,
  tickSize: 1n,
  baseUnit: 10n ** 18n,
  minTick: 1n,
  maxTick: 10_000_000n,
  feeBps: 3,
  maxFeeBps: 10,
  bandBps: 50,
  auctions: 7n,
  lastCleared: 111_117_861n,
  lastPrice: 28_605n,
  reference: { price: 28_753n, observedAt: 1791315000n, status: 0, round: 18446744073710160596n },
  ...over,
});

describe("markets and tokens, from the deployment record", () => {
  it("finds a market by id, pair, base symbol or the stock's ticker", () => {
    expect(marketByName("1")?.symbol).toBe("WMON/AUSD");
    expect(marketByName("wmon/ausd")?.id).toBe(1);
    expect(marketByName("WMON")?.id).toBe(1);
    expect(marketByName("aNVDA")?.id).toBe(0);
    expect(marketByName("NVDA")?.id).toBe(0);
  });

  it("keeps the old-rule control out of reach by name", () => {
    expect(marketByName("2")?.control).toBe(true);
    expect(marketByName("WMON/AUSD (old rule)")).toBeUndefined();
    expect(markets.filter((m) => m.control).map((m) => m.id)).toEqual([2]);
  });

  it("knows each token's decimals", () => {
    expect(tokenByName("ausd")?.decimals).toBe(6);
    expect(tokenByName("WMON")?.decimals).toBe(18);
  });
});

describe("amounts and prices", () => {
  it("parses exact amounts and refuses what a token can't hold", () => {
    expect(toUnits("2", 6)).toBe(2_000_000n);
    expect(toUnits("0.000001", 6)).toBe(1n);
    expect(() => toUnits("0.0000001", 6)).toThrow(/more than 6 decimals/);
    expect(() => toUnits("0", 6)).toThrow(/more than zero/);
    expect(() => toUnits("-1", 6)).toThrow(/not an amount/);
    expect(() => toUnits("1e3", 6)).toThrow(/not an amount/);
  });

  it("formats without trailing zeros", () => {
    expect(fromUnits(289_253n, 6)).toBe("0.289253");
    expect(fromUnits(2_000_000n, 6)).toBe("2");
    expect(fromUnits(38_731_935_000_000_000_000n, 18, 6)).toBe("38.731935");
  });

  it("rounds limits toward the trader: a buy's down, a sell's up", () => {
    expect(tickAtOrBelow(240_555_000n, 10_000n)).toBe(24_055n);
    expect(tickAtOrAbove(240_555_000n, 10_000n)).toBe(24_056n);
    expect(tickAtOrAbove(240_550_000n, 10_000n)).toBe(24_055n);
  });

  it("locks exactly what the exchange locks for a buy (OrderMath.buyLock)", () => {
    // notional rounded up, the most fee it can pay rounded up, and 4 units of slack: 288,960 + 289 + 4
    expect(buyLock(10n * 10n ** 18n, 28_896n, 10n, 10n ** 18n)).toBe(289_253n);
  });
});

describe("planning an order", () => {
  it("sets a buy's default limit 50 bp over Chainlink's newest observation, on the grid", () => {
    const p = planOrder(state(), 0, "10", {});
    expect(p.limitTick).toBe(28_896n); // 28,753 × 1.005 = 28,896.765, rounded down
    expect(p.lock).toBe(289_253n);
    expect(p.qty).toBe(10n * 10n ** 18n);
  });

  it("sets a sell's default limit below, rounded up, and locks the base", () => {
    const p = planOrder(state(), 1, "10", { slippageBps: 20 });
    expect(p.limitTick).toBe(28_696n); // 28,753 × 0.998 = 28,695.494, rounded up
    expect(p.lock).toBe(10n * 10n ** 18n);
  });

  it("takes an explicit limit in the quote token", () => {
    expect(planOrder(state(), 0, "1", { limit: "0.0285" }).limitTick).toBe(28_500n);
  });

  it("refuses the control market, a halted one, and a limit off the grid", () => {
    const control = markets.find((m) => m.control)!;
    expect(() => planOrder(state({ market: control }), 0, "1", {})).toThrow(UnisonError);
    expect(() => planOrder(state({ halted: true }), 0, "1", {})).toThrow(/not trading/);
    expect(() => planOrder(state({ maxTick: 20_000n }), 0, "1", {})).toThrow(/outside the market's price range/);
  });

  it("needs a limit when there is no observation to set one from", () => {
    let e: unknown;
    try {
      planOrder(state({ reference: null }), 0, "1", {});
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(UnisonError);
    expect((e as UnisonError).hint).toMatch(/--limit/);
  });
});

describe("the agent's wallet, from the host's wallet state", () => {
  const remote = { address: "0x1111111111111111111111111111111111111111" };
  const byok = { id: "byok:evm:0", address: "0x2222222222222222222222222222222222222222", name: "trading" };
  const sol = { address: "So11111111111111111111111111111111111111112", namespace: "solana" };

  it("follows the selection, by address, id or name", () => {
    expect(selectedEvmAddress({ remoteWallets: [remote], byokWallets: [byok], selectedWallet: { namespace: "evm", ref: { address: remote.address } } })).toBe(remote.address);
    expect(selectedEvmAddress({ remoteWallets: [remote], byokWallets: [byok], selectedWallet: { namespace: "evm", ref: { id: byok.id } } })).toBe(byok.address);
    expect(selectedEvmAddress({ remoteWallets: [remote], byokWallets: [byok], selectedWallet: { namespace: "evm", ref: { name: "trading" } } })).toBe(byok.address);
  });

  it("uses the only EVM wallet when none is selected, and refuses to guess between two", () => {
    expect(selectedEvmAddress({ remoteWallets: [remote, sol] })).toBe(remote.address);
    expect(selectedEvmAddress({ remoteWallets: [remote], byokWallets: [byok] })).toBeUndefined();
    expect(selectedEvmAddress({})).toBeUndefined();
  });

  it("ignores a Solana selection", () => {
    expect(selectedEvmAddress({ remoteWallets: [remote], selectedWallet: { namespace: "solana", ref: { address: sol.address } } })).toBe(remote.address);
  });
});

describe("a revert, explained", () => {
  it("names the venue's error and what to do about it", () => {
    const data = encodeErrorResult({ abi: unisonExchangeAbi, errorName: "InsufficientBalance" });
    const r = explainRevert({ shortMessage: "execution reverted", cause: { cause: { data } } });
    expect(r.name).toBe("InsufficientBalance");
    expect(r.hint).toMatch(/mm unison deposit/);
  });

  it("decodes the challenge's errors with their arguments", () => {
    const data = encodeErrorResult({ abi: latencyChallengeAbi, errorName: "NotEnoughFills", args: [7n] });
    expect(explainRevert({ data }).text).toBe("NotEnoughFills(7)");
  });

  it("falls back to the message for anything else", () => {
    expect(explainRevert(new Error("fetch failed\nstack")).text).toBe("fetch failed");
  });
});

describe("finding an auction from what a person has", () => {
  const TX = "0x128b8b18f4ae90cf0f79f439f5886f2f3ff548f2ebb3dcd7a847c2284351596e";
  const asked: unknown[] = [];
  const client = {
    getBlockNumber: async () => 111_056_000n,
    getContractEvents: async (q: { args: unknown; fromBlock: bigint }) => {
      asked.push(q.args);
      return q.fromBlock <= 111_055_885n ? [{ transactionHash: TX }] : [];
    },
  } as unknown as PublicClient;

  it("takes a transaction as it is", async () => {
    expect(await resolveClearTx(client, TX)).toBe(TX);
  });

  it("reads the site's receipt link, and a market and block", async () => {
    expect(await resolveClearTx(client, "https://www.unisonfi.com/receipt/mainnet/1/111055816")).toBe(TX);
    expect(await resolveClearTx(client, "1", "111055816")).toBe(TX);
    expect(asked[0]).toEqual({ marketId: 1n, upToBlock: 111_055_816n });
  });

  it("refuses anything else", async () => {
    await expect(resolveClearTx(client, "yesterday's trade")).rejects.toThrow(/receipt link/);
  });
});

describe("reading what a claim paid", () => {
  // the keeper's claim of the agent's sale on 7 October: block 111,182,202, 79 blocks after the order
  const AGENT = "0x5E986eC96d2979f278814452ad08c33C3c0AEA4b";
  const claim = { transactionHash: "0x06bb", blockNumber: 111_182_202n, args: { slot: 0n, baseAmount: 0n, quoteAmount: 283_424n, fee: 85n } };
  /** A public RPC that answers the first head from a node still behind the claim, as on 7 October. */
  const lagging = () => {
    const heads = [111_182_190n, 111_182_210n];
    return {
      getBlockNumber: async () => heads.shift() ?? 111_182_210n,
      getContractEvents: async (q: { fromBlock: bigint; toBlock: bigint }) => (q.fromBlock <= claim.blockNumber && claim.blockNumber <= q.toBlock ? [claim] : []),
    } as unknown as PublicClient;
  };

  it("finds the claim once the node it asks has the block, instead of giving up", async () => {
    const c = await findClaim(lagging(), 1, AGENT, 0n, 111_182_123n, { waitMs: 0 });
    expect(c).toEqual({ tx: "0x06bb", block: 111_182_202n, baseAmount: 0n, quoteAmount: 283_424n, fee: 85n });
  });

  it("ignores another order's claim, and says so when there is none", async () => {
    expect(await findClaim(lagging(), 1, AGENT, 3n, 111_182_123n, { tries: 2, waitMs: 0 })).toBeNull();
  });
});
