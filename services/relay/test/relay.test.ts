import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { Status, type StatusCode } from "@unison/sdk";
import { FixedProvider } from "../src/providers.ts";
import { Relay } from "../src/relay.ts";

const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

function makeRelay(p: FixedProvider, session: { s: StatusCode }, clock: { t: number }) {
  return new Relay({
    chainId: 31_337,
    venue: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    adapter: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    signer,
    signerId: 0,
    markets: [{ marketId: 0n, symbol: "aNVDA/AUSD", provider: p, session: "always", maxStaleMs: 60_000 }],
    maxBatchLag: 64n,
    headBlock: async () => 1_000n,
    now: () => clock.t,
    get sessionOverride() {
      return session.s;
    },
  });
}

describe("relay", () => {
  it("publishes live prices while open and freezes the close while closed", async () => {
    const p = new FixedProvider(180_000_000n);
    const session = { s: Status.OPEN as StatusCode };
    const clock = { t: Date.now() };
    const r = makeRelay(p, session, clock);
    expect((await r.sign(0n, 1_000n)).report.price).toBe(180_000_000n);

    session.s = Status.CLOSED; // Friday 20:00 ET
    p.price = 191_000_000n; // the "true" price moves over the weekend
    const closed = await r.sign(0n, 1_000n);
    expect(closed.report.status).toBe(Status.CLOSED);
    expect(closed.report.price).toBe(180_000_000n); // frozen at the last open print

    session.s = Status.OPEN; // Monday open publishes the gap
    expect((await r.sign(0n, 1_000n)).report.price).toBe(191_000_000n);
  });

  it("is monotonic in publish time and refuses future or stale batches", async () => {
    const clock = { t: 1_760_000_000_000 };
    const r = makeRelay(new FixedProvider(180_000_000n), { s: Status.OPEN }, clock);
    const a = await r.sign(0n, 990n);
    clock.t -= 5_000; // a clock step backwards must never produce an older report
    const b = await r.sign(0n, 991n);
    expect(b.report.publishTimeMs >= a.report.publishTimeMs).toBe(true);
    await expect(r.sign(0n, 1_001n)).rejects.toThrow(/future/);
    await expect(r.sign(0n, 900n)).rejects.toThrow(/too old/);
  });

  it("halts on demand", async () => {
    const r = makeRelay(new FixedProvider(180_000_000n), { s: Status.OPEN }, { t: Date.now() });
    r.setHalt(0n, true);
    expect((await r.sign(0n, 1_000n)).report.status).toBe(Status.HALTED);
  });
});
