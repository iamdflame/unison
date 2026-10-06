import { describe, expect, it } from "vitest";
import { readSse, type SseMessage } from "@unison/sdk/tape";
import { ADDR, E18, marketDay, memoryTape, PASSKEY, T0, tsMap } from "./helpers.ts";

const NOW = (T0 + 30) * 1000;

function loaded(opts: Parameters<typeof memoryTape>[0] = {}) {
  const t = memoryTape({ now: () => NOW, ...opts });
  const logs = marketDay();
  t.indexer.commit(logs, tsMap(logs, [11, 14]));
  return t;
}

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

/** Reads SSE messages from a streaming response until `until` says stop, then cancels the stream. */
async function collect(r: Response, until: (msgs: SseMessage[]) => boolean, ms = 3_000): Promise<SseMessage[]> {
  const msgs: SseMessage[] = [];
  const it = readSse(r.body!);
  const deadline = Date.now() + ms;
  try {
    while (!until(msgs)) {
      const next = await Promise.race([it.next(), new Promise<null>((res) => setTimeout(() => res(null), deadline - Date.now()))]);
      if (!next || next.done) break;
      msgs.push(next.value);
    }
  } finally {
    await it.return(undefined);
  }
  return msgs;
}

describe("tape REST", () => {
  it("serves health and market summaries", async () => {
    const { app } = loaded();
    expect(await json(await app.request("/health"))).toMatchObject({ ok: true, chainId: 31_337, startBlock: 0 });
    const { markets } = (await json(await app.request("/v1/markets"))) as { markets: { id: number; regime: string }[] };
    expect(markets.map((m) => [m.id, m.regime])).toEqual([
      [0, "HALTED"],
      [1, "LIVE"],
    ]);
    const m = await json(await app.request("/v1/markets/0"));
    expect(m).toMatchObject({ symbol: "aNVDA/AUSD", tickSize: "10000", baseUnit: E18.toString(), quoteDecimals: 6, auctions: 2, prints24h: 1 });
  });

  it("pages prints newest first, filters empty batches and exports CSV", async () => {
    const { app } = loaded();
    const all = (await json(await app.request("/v1/markets/0/prints"))) as { prints: { upTo: number; chainOk: boolean }[] };
    expect(all.prints.map((p) => p.upTo)).toEqual([14, 11]);
    expect(all.prints.every((p) => p.chainOk)).toBe(true);
    const traded = (await json(await app.request("/v1/markets/0/prints?traded=1"))) as { prints: { upTo: number }[] };
    expect(traded.prints.map((p) => p.upTo)).toEqual([11]);
    const before = (await json(await app.request("/v1/markets/0/prints?before=14&limit=5"))) as { prints: { upTo: number }[] };
    expect(before.prints.map((p) => p.upTo)).toEqual([11]);
    const csv = await (await app.request("/v1/markets/0/prints.csv")).text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "marketId,upTo,block,tx,logIndex,ts,tick,price,volume,refPrice,refTimeMs,status,regime,bandLo,bandHi,receiptHash,prevReceiptHash,chainOk,deviationBps,sealedAt,round,rule,causal",
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(",17990,179900000,2000000000000000000,179950000,");
  });

  it("serves candles, fairness and pending orders", async () => {
    const { app, indexer, store } = loaded();
    const { candles } = (await json(await app.request(`/v1/markets/0/candles?res=1m&from=${T0 * 1000}&to=${NOW}`))) as {
      candles: { o: string; v: string; n: number }[];
    };
    expect(candles).toEqual([{ t: Math.floor(((T0 + 12) * 1000) / 60_000) * 60_000, o: "179900000", h: "179900000", l: "179900000", c: "179900000", v: (2n * E18).toString(), n: 1 }]);
    const f = await json(await app.request("/v1/markets/0/fairness?window=1h"));
    expect(f).toMatchObject({ batches: 2, traded: 1, chainOk: true, maxAbsDevBps: 2.77 });
    // a new pending order shows up until it clears
    const { logOf } = await import("./helpers.ts");
    const { unisonExchangeAbi } = await import("@unison/sdk");
    const pending = logOf(unisonExchangeAbi as never, ADDR.exchange, "OrderPlaced", {
      marketId: 0n, account: ADDR.alice, slot: 4n, side: 1n, tick: 18_100n, qty: E18, flags: 0n, batch: 26n,
    }, { block: 26, logIndex: 0 });
    indexer.commit([pending], tsMap([pending]));
    expect(await json(await app.request("/v1/markets/0/pending"))).toEqual({
      lastCleared: 14,
      orders: [{ account: ADDR.alice, slot: 4, side: 1, tick: 18_100, qty: E18.toString(), flags: 0, batch: 26 }],
    });
    expect(store.printCount(1)).toBe(0);
  });

  it("serves account orders, fills, transfers, sessions and passkeys", async () => {
    const { app } = loaded();
    const open = (await json(await app.request(`/v1/accounts/${ADDR.alice.toUpperCase().replace("0X", "0x")}/orders`))) as { orders: { status: string }[] };
    expect(open.orders.map((o) => o.status)).toEqual(["open"]);
    const all = (await json(await app.request(`/v1/accounts/${ADDR.bob}/orders?status=all`))) as { orders: { status: string; claims: unknown[] }[] };
    expect(all.orders.map((o) => o.status)).toEqual(["cancelled", "closed"]);
    const { fills } = (await json(await app.request(`/v1/accounts/${ADDR.bob}/fills?limit=10`))) as { fills: { done: boolean; quoteAmount: string }[] };
    expect(fills).toMatchObject([{ done: true, quoteAmount: "359692060", fee: "107940", block: 13 }]);
    const { transfers } = (await json(await app.request(`/v1/accounts/${ADDR.alice}/transfers`))) as { transfers: { kind: string }[] };
    expect(transfers.map((t) => t.kind)).toEqual(["withdraw", "deposit"]);
    const { sessions } = (await json(await app.request(`/v1/accounts/${ADDR.alice}/sessions`))) as { sessions: { maxQty: string }[] };
    expect(sessions).toMatchObject([{ maxQty: (5n * E18).toString(), marketMask: "1", expiry: 1_900_000_000 }]);
    expect(await json(await app.request(`/v1/passkeys/${PASSKEY.account}`))).toEqual(PASSKEY);
    const missing = await app.request(`/v1/passkeys/${ADDR.alice}`);
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: { code: "NOT_FOUND", message: "This account has no registered passkey." } });
  });

  it("serves receipts with their auctions and verification", async () => {
    const { app } = loaded();
    const r = (await json(await app.request(`/v1/receipts/0/${ADDR.bob}/0`))) as {
      order: { status: string };
      prints: { upTo: number }[];
      verification: { chainOk: boolean; recomputed: boolean | null };
    };
    expect(r.order.status).toBe("closed");
    expect(r.prints.map((p) => p.upTo)).toEqual([11]);
    expect(r.verification).toEqual({ chainOk: true, recomputed: true });
    expect((await app.request(`/v1/receipts/0/${ADDR.alice}/9`)).status).toBe(404);
  });

  it("serves vault history and flows", async () => {
    const { app, store } = loaded();
    for (const [t, nav] of [
      [NOW - 7_200_000, "1000000000000"],
      [NOW - 60_000, "1010000000000"],
    ] as const) {
      store.putVaultSnapshot({ vault: ADDR.vault, t, block: 1, nav, supply: "1000000000000000000", base: "0", quote: nav, spreadPnl: "1", inventoryPnl: "0", decimals: 12 });
    }
    const { points } = (await json(await app.request(`/v1/vaults/${ADDR.vault}/history?res=1h`))) as { points: { sharePrice: string }[] };
    expect(points.map((p) => p.sharePrice)).toEqual(["1000000", "1010000"]); // 1.00 → 1.01 AUSD per share
    expect(await json(await app.request(`/v1/vaults/${ADDR.vault}/flows?owner=${ADDR.alice}`))).toEqual({ flows: [] });
  });

  it("answers errors in the documented shape", async () => {
    const { app } = loaded();
    const r = await app.request("/v1/nope");
    expect(r.status).toBe(404);
    expect(await json(r)).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
    expect(await json(await app.request("/v1/markets/9"))).toEqual({ error: { code: "NOT_FOUND", message: "Unknown market 9." } });
    const bad = await app.request("/v1/accounts/0x123/orders");
    expect(bad.status).toBe(400);
    expect(((await json(bad)).error as { code: string }).code).toBe("INVALID");
    expect((await app.request("/v1/markets/0/candles?res=2m")).status).toBe(400);
    expect((await app.request("/v1/stream")).status).toBe(400);
  });

  it("applies the CORS allowlist and per-IP token buckets", async () => {
    const { app } = loaded({ rateBurst: 2, corsOrigins: ["https://unison.trade"] });
    const pre = await app.request("/v1/markets", {
      method: "OPTIONS",
      headers: { origin: "https://unison.trade", "access-control-request-method": "GET" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://unison.trade");
    const other = await app.request("/health", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    expect(other.headers.get("vary")).toContain("Origin");
    expect((await app.request("/v1/markets")).status).toBe(200);
    expect((await app.request("/v1/markets")).status).toBe(200);
    const limited = await app.request("/v1/markets");
    expect(limited.status).toBe(429);
    expect(((await json(limited)).error as { code: string }).code).toBe("RATE_LIMITED");
    expect((await app.request("/health")).status).toBe(200); // health is never limited
  });
});

describe("tape SSE", () => {
  it("replays after Last-Event-ID, then streams live events for the requested topics only", async () => {
    const { app, indexer } = loaded();
    indexer.publishHead(26, T0 + 26);
    const r = await app.request("/v1/stream?topics=prints:0,heads", { headers: { "last-event-id": "12:0" } });
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    setTimeout(() => indexer.publishHead(27, T0 + 27), 50);
    const msgs = await collect(r, (m) => m.some((x) => x.id === "27:-1"));
    expect(msgs.map((m) => `${m.event}@${m.id}`)).toEqual(["print@15:0", "head@26:-1", "head@27:-1"]);
    expect(JSON.parse(msgs[0]!.data)).toMatchObject({ marketId: 0, upTo: 14, chainOk: true });
    expect(JSON.parse(msgs[2]!.data)).toEqual({ block: 27, ts: (T0 + 27) * 1000 });
  });

  it("scopes account topics and falls back to (block, logIndex) order for ids that left the ring", async () => {
    const { app } = loaded();
    const r = await app.request(`/v1/stream?topics=account:${ADDR.alice.toUpperCase().replace("0X", "0x")}&lastEventId=12:5`);
    const msgs = await collect(r, (m) => m.length >= 4);
    expect(msgs.map((m) => `${m.event}@${m.id}`)).toEqual(["order@13:0", "fill@13:0", "transfer@22:0", "transfer@22:1"]);
  });

  it("sends keepalive comments while idle", async () => {
    const { app } = loaded({ keepaliveMs: 30 });
    const r = await app.request("/v1/stream?topics=heads");
    const reader = r.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const until = Date.now() + 2_000;
    while (!text.includes(": keepalive") && Date.now() < until) text += decoder.decode((await reader.read()).value);
    await reader.cancel();
    expect(text).toContain(": connected");
    expect(text).toContain(": keepalive");
  });
});
