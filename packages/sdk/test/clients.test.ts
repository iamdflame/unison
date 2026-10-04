import { describe, expect, it } from "vitest";
import { buildOrder } from "../src/gateway.ts";
import { RelayerClient, RelayerError, type RelayerJob } from "../src/relayer.ts";
import { readSse, TapeClient, TapeError, type HeadEvent, type Print } from "../src/tape.ts";

type Call = { url: string; init?: RequestInit };

/** fetch double: answers from `route`, records calls. */
function fakeFetch(route: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    return route(url, init);
  }) as typeof fetch;
  return { f, calls };
}

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("RelayerClient", () => {
  it("posts actions with bigints as decimal strings", async () => {
    const { f, calls } = fakeFetch(() => ok({ id: "j1" }, 202));
    const c = new RelayerClient("http://relayer/", { fetch: f });
    const o = buildOrder({ account: "0x00000000000000000000000000000000000000aa", marketId: 0n, side: 0, tick: 18_000, qty: 10n ** 18n });
    expect(await c.postOrder(o, "0x01")).toEqual({ id: "j1" });
    expect(calls[0]!.url).toBe("http://relayer/v1/orders");
    const body = JSON.parse(String(calls[0]!.init!.body)) as { order: Record<string, unknown>; sig: string };
    expect(body.order).toMatchObject({ marketId: "0", qty: "1000000000000000000", tick: 18_000, side: 0, nonce: o.nonce.toString() });
    await c.claim("0x00000000000000000000000000000000000000aa", [1n, 2]);
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ account: "0x00000000000000000000000000000000000000aa", slots: [1, 2] });
  });

  it("throws typed errors with the relayer's code and message", async () => {
    const { f } = fakeFetch(() => ok({ error: { code: "SessionCap", message: "Over this session's limits." } }, 400));
    const err = await new RelayerClient("http://r", { fetch: f }).faucet("0x00000000000000000000000000000000000000aa").catch((e) => e);
    expect(err).toBeInstanceOf(RelayerError);
    expect(err).toMatchObject({ code: "SessionCap", message: "Over this session's limits.", status: 400 });
    const { f: html } = fakeFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await new RelayerClient("http://r", { fetch: html }).health().catch((e) => e)).toMatchObject({ code: "UNAVAILABLE", status: 502 });
  });

  it("waits for a job, surfaces failures and honours aborts", async () => {
    const seq: RelayerJob[] = [
      { id: "a", kind: "order", status: "queued" },
      { id: "a", kind: "order", status: "sent", tx: "0x01" },
      { id: "a", kind: "order", status: "done", tx: "0x01", result: { slot: 3 } },
    ];
    const { f } = fakeFetch(() => ok(seq.shift()));
    expect(await new RelayerClient("http://r", { fetch: f }).waitForJob("a", { intervalMs: 1 })).toMatchObject({ status: "done", result: { slot: 3 } });

    const failed: RelayerJob = { id: "b", kind: "order", status: "failed", error: { code: "NonceUsed", message: "Already submitted." } };
    const { f: f2 } = fakeFetch(() => ok(failed));
    const e = await new RelayerClient("http://r", { fetch: f2 }).waitForJob("b").catch((x) => x);
    expect(e).toMatchObject({ code: "NonceUsed", job: failed });

    const { f: f3 } = fakeFetch(() => ok({ id: "c", kind: "order", status: "queued" }));
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(new Error("stop")), 20);
    await expect(new RelayerClient("http://r", { fetch: f3 }).waitForJob("c", { intervalMs: 5, signal: ctl.signal })).rejects.toThrow("stop");
    await expect(new RelayerClient("http://r", { fetch: f3 }).waitForJob("c", { intervalMs: 1, timeoutMs: 5 })).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("TapeClient", () => {
  it("builds typed requests and unwraps list responses", async () => {
    const { f, calls } = fakeFetch((url) => {
      if (url.includes("/prints")) return ok({ prints: [{ upTo: 9 } as Print] });
      if (url.includes("/v1/markets")) return ok({ markets: [{ id: 0 }] });
      return ok({ candles: [] });
    });
    const t = new TapeClient("http://tape/", { fetch: f });
    expect(await t.prints(0, { limit: 5, traded: true, before: 100 })).toEqual([{ upTo: 9 }]);
    expect(calls[0]!.url).toBe("http://tape/v1/markets/0/prints?limit=5&traded=1&before=100");
    expect(await t.markets()).toEqual([{ id: 0 }]);
    await t.candles(0, { res: "5m" });
    expect(calls[2]!.url).toBe("http://tape/v1/markets/0/candles?res=5m");
  });

  it("maps a missing passkey to null and other errors to TapeError", async () => {
    const { f } = fakeFetch((url) =>
      url.includes("passkeys")
        ? ok({ error: { code: "NOT_FOUND", message: "no" } }, 404)
        : ok({ error: { code: "RATE_LIMITED", message: "slow down" } }, 429),
    );
    const t = new TapeClient("http://tape", { fetch: f });
    expect(await t.passkey("0xabc")).toBeNull();
    await expect(t.fills("0xabc")).rejects.toEqual(new TapeError(429, "RATE_LIMITED", "slow down"));
  });

  it("streams with the fetch reader and resumes with Last-Event-ID after a drop", async () => {
    let connection = 0;
    const { f, calls } = fakeFetch(() => {
      connection++;
      const body =
        connection === 1
          ? 'retry: 1000\n: connected\n\nevent: head\nid: 7:-1\ndata: {"block":7,"ts":7000}\n\n'
          : 'event: head\nid: 8:-1\ndata: {"block":8,\ndata: "ts":8000}\n\n';
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    const heads: [HeadEvent, string][] = [];
    const t = new TapeClient("http://tape", { fetch: f });
    const s = t.stream(["heads"], { head: (h, id) => heads.push([h, id]) }, { reconnectMs: 5 });
    const until = Date.now() + 2_000;
    while (heads.length < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 5));
    s.close();
    expect(heads).toEqual([
      [{ block: 7, ts: 7000 }, "7:-1"],
      [{ block: 8, ts: 8000 }, "8:-1"], // multi-line data joins with \n
    ]);
    expect(calls[0]!.url).toBe("http://tape/v1/stream?topics=heads");
    expect((calls[1]!.init!.headers as Record<string, string>)["last-event-id"]).toBe("7:-1");
    expect(s.lastEventId).toBe("8:-1");
  });

  it("parses SSE framing exactly", async () => {
    const enc = new TextEncoder();
    const chunks = ["event: print\r\nid: 1:0\r\ndata: {\"a\"", ":1}\r\n\r\n: comment\n\nevent: x\ndata\n\n"];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    });
    const out = [];
    for await (const m of readSse(body)) out.push(m);
    expect(out).toEqual([
      { event: "print", id: "1:0", data: '{"a":1}' },
      { event: "x", data: "" },
    ]);
  });
});
