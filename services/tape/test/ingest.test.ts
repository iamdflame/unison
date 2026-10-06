import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Abi, Hex } from "viem";
import { liquidityVaultAbi, orderGatewayAbi, unisonExchangeAbi, type Deployment } from "@unison/sdk";
import { LogDecoder, type RawLog } from "../src/decode.ts";
import { ZERO_HASH } from "../src/derive.ts";
import { rawOf } from "../src/ingest.ts";
import type { HubEvent } from "../src/stream.ts";
import { accountOrders, latestSessions, marketSummary, pendingOrders } from "../src/views.ts";
import { ADDR, deployment, E18, logOf, marketDay, memoryTape, PASSKEY, printLog, T0, tsMap } from "./helpers.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/devnet-e2e.json", import.meta.url), "utf8")) as {
  deployment: Deployment;
  head: number;
  timestamps: Record<string, number>;
  logs: RawLog[];
};

const decoder = new LogDecoder({
  exchange: ADDR.exchange,
  gateway: ADDR.gateway,
  operatorReference: ADDR.reference,
  vaults: [ADDR.vault],
});

describe("decoding", () => {
  it("decodes each contract with its own ABI (the vault's Deposited is not the exchange's)", () => {
    const vaultDeposit = logOf(liquidityVaultAbi as Abi, ADDR.vault, "Deposited", {
      id: 4n, owner: ADDR.alice, assets: 1_000n, shares: 999n, nav: 5_000n, swingFee: 3n,
    }, { block: 1, logIndex: 0 });
    expect(decoder.decode(vaultDeposit, 1_000)).toMatchObject({
      table: "vault_events",
      row: { event: "Deposited", requestId: 4, owner: ADDR.alice, amount: "1000", shares: "999", swingFee: "3", vault: ADDR.vault },
    });
    const exchangeDeposit = logOf(unisonExchangeAbi as Abi, ADDR.exchange, "Deposited", {
      account: ADDR.alice, token: ADDR.ausd, amount: 7n, payer: ADDR.bob,
    }, { block: 1, logIndex: 1 });
    expect(decoder.decode(exchangeDeposit, 1_000)).toMatchObject({
      table: "transfers",
      row: { kind: "deposit", account: ADDR.alice, token: ADDR.ausd, amount: "7", counterparty: ADDR.bob, ts: 1_000 },
    });
  });

  it("decodes relayed actions, failures and session grants", () => {
    const relayed = logOf(orderGatewayAbi as Abi, ADDR.gateway, "Relayed", {
      account: ADDR.alice, authorizedBy: ADDR.bob, kind: 1, action: `0x${Buffer.from("place").toString("hex").padEnd(64, "0")}`, ref: 3n,
    }, { block: 2, logIndex: 0 });
    expect(decoder.decode(relayed, 0)).toMatchObject({ table: "relayed", row: { ok: true, action: "place", ref: "3", kind: 1 } });
    const failed = logOf(orderGatewayAbi as Abi, ADDR.gateway, "RelayFailed", { account: ADDR.alice, index: 2n, reason: "0xf4d678b8" }, { block: 2, logIndex: 1 });
    expect(decoder.decode(failed, 0)).toMatchObject({ table: "relayed", row: { ok: false, index: 2, reason: "0xf4d678b8" } });
  });

  it("ignores foreign contracts and events the tape doesn't serve", () => {
    const foreign = { ...marketDay()[0]!, address: "0x0000000000000000000000000000000000000001" };
    expect(decoder.decode(foreign, 0)).toBeUndefined();
    const transfer = logOf(liquidityVaultAbi as Abi, ADDR.vault, "Transfer", { from: ADDR.alice, to: ADDR.bob, value: 1n }, { block: 3, logIndex: 0 });
    expect(decoder.decode(transfer, 0)).toBeUndefined();
  });

  it("normalises viem and WebSocket logs alike", () => {
    const ws = rawOf({ address: ADDR.exchange, topics: [], data: "0x", blockNumber: "0x1a", logIndex: "0x2", transactionHash: "0xab", removed: true, blockTimestamp: "0x10" });
    expect(ws).toMatchObject({ blockNumber: 26, logIndex: 2, removed: true, blockTimestamp: 16 });
    const viem = rawOf({ address: ADDR.exchange, topics: [], data: "0x", blockNumber: 26n, logIndex: 2, transactionHash: "0xab", removed: false });
    expect(viem.blockTimestamp).toBeUndefined();
  });
});

describe("commit", () => {
  it("indexes a market day, derives state and publishes SSE events after commit", () => {
    const { store, hub, indexer } = memoryTape();
    const events: HubEvent[] = [];
    hub.subscribe(new Set(["prints", "regime", `account:${ADDR.alice}`, `account:${ADDR.bob}`]), (e) => events.push(e));
    const logs = marketDay();
    indexer.commit(logs, tsMap(logs, [11, 14]));

    const prints = store.prints(0, { asc: true });
    expect(prints.map((p) => [p.upTo, p.chainOk, p.regime, p.deviationBps])).toEqual([
      [11, true, "LIVE", -2.77],
      [14, true, "LIVE", null],
    ]);
    expect(prints[0]!.closeTs).toBe(T0 + 11);
    expect(prints[0]!.ts).toBe((T0 + 12) * 1000);
    expect(indexer.lastCleared(0)).toBe(14);
    expect(indexer.halted(0)).toBe(true);

    const alice = accountOrders(store, indexer, ADDR.alice, "all");
    expect(alice).toHaveLength(1);
    expect(alice[0]).toMatchObject({ status: "open", filled: (2n * E18).toString(), quote: "359800000", avgPrice: "179900000" });
    const bob = accountOrders(store, indexer, ADDR.bob, "all");
    expect(bob.map((o) => [o.slot, o.status, o.filled])).toEqual([
      [1, "cancelled", "0"],
      [0, "closed", (2n * E18).toString()],
    ]);
    expect(accountOrders(store, indexer, ADDR.bob, "open")).toEqual([]);
    expect(pendingOrders(store, indexer, 0).orders).toEqual([]); // Bob's pending bid was cancelled
    expect(latestSessions(store.sessions(ADDR.alice))).toMatchObject([{ key: "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc", expiry: 1_900_000_000 }]);
    expect(store.passkey(PASSKEY.account)).toMatchObject({ qx: PASSKEY.qx, qy: PASSKEY.qy });

    const summary = marketSummary(store, indexer, indexer.markets.get(0)!, (T0 + 30) * 1000);
    expect(summary).toMatchObject({ auctions: 2, halted: true, regime: "HALTED", prints24h: 1, volume24h: (2n * E18).toString(), open24h: "179900000" });
    expect(summary.lastPrint?.upTo).toBe(11);
    expect(summary.ref).toEqual({ price: "180000000", publishTimeMs: (T0 + 14) * 1000 + 400, status: 0 });

    expect(events.map((e) => `${e.event}@${e.id}`)).toEqual([
      "order@10:0",
      "order@10:1",
      "print@12:0",
      "order@13:0",
      "fill@13:0",
      "order@13:1",
      "fill@13:1",
      "print@15:0",
      "order@20:0",
      "order@21:0",
      "transfer@22:0",
      "transfer@22:1",
      "session@23:0",
      "regime@25:0",
    ]);
    expect(JSON.parse(events.find((e) => e.event === "regime")!.data)).toEqual({ marketId: 0, kind: "halt", data: { halted: true, by: ADDR.bob } });
    // re-ingesting the same window is a no-op
    indexer.commit(logs, tsMap(logs, [11, 14]));
    expect(store.printCount(0)).toBe(2);
    expect(hub.size).toBe(14);
  });

  it("re-derives the chain when an earlier print arrives late, and when one is retracted", () => {
    const { store, indexer } = memoryTape();
    const p1 = printLog(ZERO_HASH, { upTo: 4, tick: 18_000, volume: E18, refPrice: 180_000_000n }, { block: 5, logIndex: 0 });
    const p2 = printLog(p1.receipt, { upTo: 6, tick: 18_010, volume: E18, refPrice: 180_100_000n, status: 2 }, { block: 7, logIndex: 0 });
    const p3 = printLog(p2.receipt, { upTo: 8, tick: 18_020, volume: E18, refPrice: 180_200_000n }, { block: 9, logIndex: 0 });
    const ts = tsMap([p1.log, p2.log, p3.log]);
    indexer.commit([p1.log, p3.log], ts); // p2 missed (e.g. a dropped WebSocket message)
    expect(store.prints(0, { asc: true }).map((p) => p.chainOk)).toEqual([true, false]);
    indexer.commit([p2.log], ts); // the reconciliation poll finds it
    expect(store.prints(0, { asc: true }).map((p) => [p.chainOk, p.regime])).toEqual([
      [true, "LIVE"],
      [true, "DISCOVERY"],
      [true, "REOPENING"], // the auction after a CLOSED one
    ]);

    store.setMeta("indexed", "20");
    indexer.commit([{ ...p2.log, removed: true }], ts); // the chain dropped it after all
    expect(store.prints(0, { asc: true }).map((p) => [p.upTo, p.chainOk, p.regime])).toEqual([
      [4, true, "LIVE"],
      [8, false, "LIVE"],
    ]);
    expect(indexer.indexed).toBe(6); // the reconciliation poll refetches from the retracted block
  });

  it("publishes one head per block whatever the source", () => {
    const { hub, indexer } = memoryTape();
    for (const b of [5, 5, 4, 6, 6]) indexer.publishHead(b, T0 + b);
    expect(hub.replay("0:0", new Set(["heads"])).map((e) => [e.id, JSON.parse(e.data)])).toEqual([
      ["5:-1", { block: 5, ts: (T0 + 5) * 1000 }],
      ["6:-1", { block: 6, ts: (T0 + 6) * 1000 }],
    ]);
  });

  it("indexes the recorded devnet session end to end", () => {
    const { store, indexer } = memoryTape();
    const ts = new Map(Object.entries(fixture.timestamps).map(([b, t]) => [Number(b), t]));
    indexer.commit(fixture.logs, ts);
    const prints = store.prints(0, { asc: true });
    expect(prints.length).toBeGreaterThanOrEqual(3);
    expect(prints.every((p) => p.chainOk)).toBe(true);
    expect(prints.every((p) => p.regime === "LIVE")).toBe(true);
    expect(prints.filter((p) => p.volume !== "0").every((p) => p.deviationBps !== null && Math.abs(p.deviationBps) < 50)).toBe(true);
    expect(prints.every((p) => p.closeTs !== null && p.refTimeMs >= p.closeTs * 1000)).toBe(true);

    const accounts = fixture.deployment.accounts!;
    const t1 = accounts.trader1!.toLowerCase();
    const t1Orders = accountOrders(store, indexer, t1, "all");
    expect(t1Orders[t1Orders.length - 1]).toMatchObject({ side: 0, status: "closed" });
    expect(BigInt(t1Orders[t1Orders.length - 1]!.filled)).toBeGreaterThan(0n);
    expect(store.transfers(t1).some((t) => t.kind === "deposit")).toBe(true);

    const passkeys = store.db.prepare("SELECT account FROM passkeys").all() as { account: string }[];
    expect(passkeys).toHaveLength(1);
    const pk = accountOrders(store, indexer, passkeys[0]!.account, "all");
    expect(pk).toHaveLength(1);
    expect(pk[0]).toMatchObject({ side: 1, status: "closed" });
    const relayed = store.db.prepare("SELECT COUNT(*) AS n FROM relayed WHERE ok = 1").get() as { n: number };
    expect(relayed.n).toBeGreaterThanOrEqual(2);
    const t3 = accounts.trader3!.toLowerCase();
    expect(latestSessions(store.sessions(t3))).toHaveLength(1);
    const flows = store.vaultEvents(fixture.deployment.markets["aNVDA/AUSD"]!.vault!.toLowerCase());
    expect(flows.map((f) => f.event)).toEqual(["DepositRequested", "Deposited"]);
    expect(store.lastReference(0)).toBeDefined();
  });
});

describe("deployment wiring", () => {
  it("watches the exchange, the gateway, the reference adapter and every vault", () => {
    const { indexer } = memoryTape();
    expect(new Set(indexer.decoder.addresses)).toEqual(
      new Set([deployment.exchange, deployment.gateway!, deployment.operatorReference!, ADDR.vault].map((a) => a.toLowerCase() as Hex)),
    );
  });
});

describe("causal markets (SPEC §7.4)", () => {
  it("joins each print to the Chainlink round that priced it, and checks for itself that it was observed after the seal", async () => {
    const { fairness, toPrint } = await import("../src/derive.ts");
    const { store, indexer } = memoryTape();
    const round = 18_446_744_073_710_158_838n;
    const causal = logOf(unisonExchangeAbi as Abi, ADDR.exchange, "CausalReference", {
      marketId: 0n, upToBlock: 11n, round, sealedAt: BigInt(T0 + 11), observedAt: BigInt(T0 + 11),
    }, { block: 12, logIndex: 0 });
    const { log, receipt } = printLog(ZERO_HASH, { upTo: 11, tick: 17_990, volume: E18, refPrice: 180_000_000n }, { block: 12, logIndex: 1 });
    // an older print with no CausalReference: the clear-time rule
    const { log: later } = printLog(receipt, { upTo: 14, tick: 17_995, volume: 0n, refPrice: 180_000_000n }, { block: 15, logIndex: 0 });
    const logs = [causal, log, later];
    indexer.commit(logs, tsMap(logs, [11, 14]));
    const [p11, p14] = store.prints(0, { asc: true });
    expect(p11!.round).toBe(round.toString());
    expect(toPrint(p11!)).toMatchObject({ rule: "causal", causal: true, sealedAt: T0 + 11, round: round.toString() });
    expect(toPrint(p14!)).toMatchObject({ rule: "clear-time", causal: false, round: null });
    expect(fairness(store.prints(0, { asc: true })).causal).toMatchObject({ prints: 1, allAfterSeal: true });
  });
});
