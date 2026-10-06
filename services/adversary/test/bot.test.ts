import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { Adversary, signal, type Chain, type Leg } from "../src/bot.ts";

const UNISON: Address = "0x00000000000000000000000000000000000000a1";
const CONTROL: Address = "0x00000000000000000000000000000000000000a2";
const legs: Leg[] = [
  { name: "unison", account: UNISON },
  { name: "control", account: CONTROL },
];

function fakeChain(state: { price: bigint; round: bigint; open: Set<Address>; ran: Set<Address> }) {
  const orders: { account: Address; side: number; tick: bigint; qty: bigint }[] = [];
  const settled: Address[] = [];
  const chain: Chain = {
    latest: vi.fn(async () => ({ price: state.price, round: state.round })),
    orderOpen: vi.fn(async (a: Address) => state.open.has(a)),
    order: vi.fn(async (a: Address, side, tick, qty) => {
      orders.push({ account: a, side, tick, qty });
      state.open.add(a);
      return "0x01" as Hex;
    }),
    settle: vi.fn(async (a: Address) => {
      if (!state.ran.has(a)) return false;
      state.open.delete(a);
      settled.push(a);
      return true;
    }),
  };
  return { chain, orders, settled };
}

const bot = (chain: Chain) =>
  new Adversary({ chain, legs, thresholdBps: 25, qty: 10n * 10n ** 18n, tickSize: 1n, slippageBps: 50, log: () => {} });

describe("the signal", () => {
  it("trades toward the exchange price once it has left Chainlink's landed round behind by the threshold", () => {
    expect(signal(0.03009, 0.03, 25)).toBe(0); // +30 bp: buy before Chainlink catches up
    expect(signal(0.02991, 0.03, 25)).toBe(1); // −30 bp: sell
    expect(signal(0.03006, 0.03, 25)).toBeNull(); // +20 bp: inside the vault's spread and fee
    expect(signal(0, 0.03, 25)).toBeNull();
  });
});

describe("the adversary", () => {
  it("fires on both legs at once, same side, same size, with a limit past the exchange price", async () => {
    const s = { price: 30_000n, round: 7n, open: new Set<Address>(), ran: new Set<Address>() };
    const { chain, orders } = fakeChain(s);
    expect(await bot(chain).onPrice(0.0301)).toBe(true); // +33 bp
    expect(orders.map((o) => [o.account, o.side])).toEqual([
      [UNISON, 0],
      [CONTROL, 0],
    ]);
    expect(orders[0]!.tick).toBe(30_250n); // 0.0301 × 1.005 = 0.03025049…, in millionths of an AUSD
    expect(orders[0]!.qty).toBe(orders[1]!.qty);
  });

  it("trades once per Chainlink round, and never while an order is open", async () => {
    const s = { price: 30_000n, round: 7n, open: new Set<Address>(), ran: new Set<Address>() };
    const { chain, orders } = fakeChain(s);
    const b = bot(chain);
    await b.onPrice(0.0301);
    expect(await b.onPrice(0.0302)).toBe(false); // orders open
    s.ran.add(UNISON).add(CONTROL);
    await b.settle();
    expect(await b.onPrice(0.0302)).toBe(false); // the same round: that move is already traded
    s.round = 8n;
    expect(await b.onPrice(0.0302)).toBe(true);
    expect(orders).toHaveLength(4);
  });

  it("records each leg once its auction has run", async () => {
    const s = { price: 30_000n, round: 7n, open: new Set<Address>(), ran: new Set<Address>() };
    const { chain, settled } = fakeChain(s);
    const b = bot(chain);
    await b.onPrice(0.0299); // sell
    s.ran.add(CONTROL); // the old rule cleared at once; Unison waits for Chainlink's next observation
    expect(await b.settle()).toBe(1);
    expect(settled).toEqual([CONTROL]);
    s.ran.add(UNISON);
    expect(await b.settle()).toBe(1);
    expect(settled).toEqual([CONTROL, UNISON]);
  });
});
