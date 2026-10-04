/** Token buckets keyed by client (IP). Idle buckets are swept so the map stays bounded. */
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  readonly burst: number;
  readonly perSec: number;
  private readonly now: () => number;
  private sweptAt = 0;

  constructor(burst: number, perSec: number, now: () => number = Date.now) {
    this.burst = burst;
    this.perSec = perSec;
    this.now = now;
  }

  /** Takes `cost` tokens; returns 0 when allowed, else the seconds until enough tokens refill. */
  take(key: string, cost = 1): number {
    const now = this.now();
    if (now - this.sweptAt > 60_000) this.sweep(now);
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSec);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return 0;
    }
    return Math.ceil((cost - b.tokens) / this.perSec);
  }

  private sweep(now: number) {
    this.sweptAt = now;
    const full = (this.burst / this.perSec) * 1000;
    for (const [k, b] of this.buckets) if (now - b.at > full) this.buckets.delete(k);
  }
}

/** Client IP: the proxy's header when behind one (Fly sets Fly-Client-IP), else the socket address. */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const fly = c.req.header("fly-client-ip");
    if (fly) return fly.trim();
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "local"; // app.request() in tests has no socket
  }
}
