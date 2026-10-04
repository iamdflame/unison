/**
 * The tape's HTTP API (docs/API.md): REST history, CSV, and SSE live data. Errors are
 * `{ error: { code, message } }`; CORS is an allowlist; every client IP has a token bucket.
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { TapeStore } from "./db.ts";
import {
  buildCandles,
  FAIRNESS_WINDOW_MS,
  fairness,
  printsCsv,
  RESOLUTION_MS,
  toPrint,
  vaultFlows,
  vaultPoints,
} from "./derive.ts";
import { clientIp, TokenBuckets } from "./limits.ts";
import { parseTopics, type HubEvent, type StreamHub } from "./stream.ts";
import {
  accountOrders,
  fillOf,
  latestSessions,
  marketSummary,
  pendingOrders,
  receiptOf,
  transferOf,
  type TapeState,
} from "./views.ts";

export interface TapeApiOptions {
  store: TapeStore;
  state: TapeState;
  hub: StreamHub;
  corsOrigins?: string[];
  /** per-IP token bucket */
  rateBurst?: number;
  ratePerSec?: number;
  trustProxy?: boolean;
  keepaliveMs?: number;
  now?: () => number;
}

type Status = 400 | 404 | 429 | 503;

export const fail = (c: Context, status: Status, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address")
  .transform((s) => s.toLowerCase());
const uint = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const flag = z
  .enum(["0", "1", "true", "false"])
  .optional()
  .transform((v) => v === "1" || v === "true");

class Invalid extends Error {}
class NotFound extends Error {}

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new Invalid(`${i.path.join(".") || "request"}: ${i.message}`);
  }
  return r.data;
}

export function createTapeApp(opts: TapeApiOptions): Hono {
  const { store, state, hub } = opts;
  const now = opts.now ?? Date.now;
  const keepaliveMs = opts.keepaliveMs ?? 15_000;
  const buckets = new TokenBuckets(opts.rateBurst ?? 120, opts.ratePerSec ?? 30, now);
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: opts.corsOrigins ?? ["http://localhost:3000"],
      allowMethods: ["GET", "HEAD", "OPTIONS"],
      allowHeaders: ["Content-Type", "Last-Event-ID", "Cache-Control"],
      maxAge: 600,
    }),
  );
  app.use("/v1/*", async (c, next) => {
    const wait = buckets.take(clientIp(c, opts.trustProxy ?? false));
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      return fail(c, 429, "RATE_LIMITED", "Too many requests. Slow down.");
    }
    await next();
  });
  app.onError((err, c) => {
    if (err instanceof NotFound) return fail(c, 404, "NOT_FOUND", err.message);
    if (err instanceof Invalid) return fail(c, 400, "INVALID", err.message);
    console.error(JSON.stringify({ svc: "tape", level: "error", path: c.req.path, error: err.message }));
    return fail(c, 503, "UNAVAILABLE", "The tape couldn't answer. Retry shortly.");
  });
  app.notFound((c) => fail(c, 404, "NOT_FOUND", "Not found."));

  const market = (c: Context) => {
    const id = parse(uint, c.req.param("id"));
    const m = state.markets.get(id);
    if (!m) throw new NotFound(`Unknown market ${id}.`);
    return m;
  };

  app.get("/health", (c) =>
    c.json({
      ok: true,
      chainId: state.chainId,
      head: state.head,
      indexed: state.indexed,
      lagBlocks: Math.max(0, state.head - state.indexed),
      startBlock: state.startBlock,
    }),
  );

  // ------------------------------------------------------------------------------------------ markets

  app.get("/v1/markets", (c) =>
    c.json({ markets: [...state.markets.values()].sort((a, b) => a.id - b.id).map((m) => marketSummary(store, state, m, now())) }),
  );

  app.get("/v1/markets/:id", (c) => c.json(marketSummary(store, state, market(c), now())));

  app.get("/v1/markets/:id/prints", (c) => {
    const m = market(c);
    const q = parse(
      z.object({ limit: uint.min(1).max(1_000).default(100), before: uint.optional(), traded: flag }),
      c.req.query(),
    );
    const rows = store.prints(m.id, { limit: q.limit, traded: q.traded, ...(q.before === undefined ? {} : { before: q.before }) });
    return c.json({ prints: rows.map(toPrint) });
  });

  app.get("/v1/markets/:id/prints.csv", (c) => {
    const m = market(c);
    const q = parse(z.object({ from: uint.optional(), to: uint.optional() }), c.req.query());
    const rows = store.prints(m.id, { asc: true, limit: 100_000, ...q });
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${m.symbol.replace(/\W+/g, "-")}-prints.csv"`);
    return c.body(printsCsv(rows.map(toPrint)));
  });

  app.get("/v1/markets/:id/candles", (c) => {
    const m = market(c);
    const q = parse(
      z.object({ res: z.enum(["1m", "5m", "15m", "1h", "1d"]).default("1m"), from: uint.optional(), to: uint.optional() }),
      c.req.query(),
    );
    const resMs = RESOLUTION_MS[q.res];
    const to = q.to ?? now();
    const from = Math.max(q.from ?? to - 500 * resMs, to - 5_000 * resMs); // at most 5000 candles
    return c.json({ candles: buildCandles(store.prints(m.id, { from, to, traded: true, asc: true }), resMs) });
  });

  app.get("/v1/markets/:id/fairness", (c) => {
    const m = market(c);
    const q = parse(z.object({ window: z.enum(["1h", "24h", "7d"]).default("24h") }), c.req.query());
    return c.json(fairness(store.prints(m.id, { from: now() - FAIRNESS_WINDOW_MS[q.window], asc: true })));
  });

  app.get("/v1/markets/:id/pending", (c) => c.json(pendingOrders(store, state, market(c).id)));

  // ------------------------------------------------------------------------------------------ accounts

  const account = (c: Context, name = "addr") => parse(address, c.req.param(name));

  app.get("/v1/accounts/:addr/orders", (c) => {
    const addr = account(c);
    const q = parse(z.object({ status: z.enum(["open", "all"]).default("open") }), c.req.query());
    return c.json({ orders: accountOrders(store, state, addr, q.status) });
  });

  app.get("/v1/accounts/:addr/fills", (c) => {
    const addr = account(c);
    const q = parse(z.object({ limit: uint.min(1).max(1_000).default(100) }), c.req.query());
    return c.json({ fills: store.claims(addr, q.limit).map(fillOf) });
  });

  app.get("/v1/accounts/:addr/transfers", (c) => c.json({ transfers: store.transfers(account(c)).map(transferOf) }));

  app.get("/v1/accounts/:addr/sessions", (c) => c.json({ sessions: latestSessions(store.sessions(account(c))) }));

  app.get("/v1/passkeys/:account", (c) => {
    const p = store.passkey(account(c, "account"));
    if (!p) return fail(c, 404, "NOT_FOUND", "This account has no registered passkey.");
    return c.json({ account: p.account, qx: p.qx, qy: p.qy });
  });

  // ------------------------------------------------------------------------------------------ vaults

  app.get("/v1/vaults/:addr/history", (c) => {
    const vault = account(c);
    const q = parse(z.object({ res: z.enum(["1h", "1d"]).default("1h") }), c.req.query());
    const span = q.res === "1h" ? 30 * 86_400_000 : 365 * 86_400_000;
    return c.json({ points: vaultPoints(store.vaultSnapshots(vault, now() - span), RESOLUTION_MS[q.res]) });
  });

  app.get("/v1/vaults/:addr/flows", (c) => {
    const vault = account(c);
    const q = parse(z.object({ owner: address.optional() }), c.req.query());
    return c.json({ flows: vaultFlows(store.vaultEvents(vault, q.owner)) });
  });

  // ------------------------------------------------------------------------------------------ receipts

  app.get("/v1/receipts/:marketId/:account/:slot", (c) => {
    const marketId = parse(uint, c.req.param("marketId"));
    const acct = account(c, "account");
    const slot = parse(uint.max(54), c.req.param("slot"));
    const r = receiptOf(store, state, marketId, acct, slot);
    if (!r) return fail(c, 404, "NOT_FOUND", "No order in this slot.");
    return c.json(r);
  });

  // ------------------------------------------------------------------------------------------ live stream

  app.get("/v1/stream", (c) => {
    const topics = parseTopics(c.req.query("topics"));
    if (topics.size === 0) return fail(c, 400, "INVALID", "topics: e.g. topics=heads,prints:0,account:0x…");
    const lastId = c.req.header("last-event-id") ?? c.req.query("lastEventId");
    return streamSSE(c, async (stream) => {
      const queue: HubEvent[] = [];
      let wake: (() => void) | undefined;
      // subscribe before replaying so nothing published meanwhile is lost (duplicates are skipped by seq)
      const unsubscribe = hub.subscribe(topics, (e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      let lastSeq = 0;
      const send = async (e: HubEvent) => {
        if (e.seq <= lastSeq) return;
        lastSeq = e.seq;
        await stream.writeSSE({ event: e.event, data: e.data, id: e.id });
      };
      try {
        await stream.write("retry: 1000\n: connected\n\n");
        if (lastId) for (const e of hub.replay(lastId, topics)) await send(e);
        while (!stream.aborted && !stream.closed) {
          if (queue.length === 0) {
            const idle = await new Promise<boolean>((resolve) => {
              const t = setTimeout(() => {
                wake = undefined;
                resolve(true);
              }, keepaliveMs);
              wake = () => {
                clearTimeout(t);
                wake = undefined;
                resolve(false);
              };
            });
            if (idle && !stream.aborted) await stream.write(": keepalive\n\n");
            continue;
          }
          while (queue.length > 0) await send(queue.shift()!);
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return app;
}
