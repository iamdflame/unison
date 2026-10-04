/**
 * Field-style vitals on a production build, under a mid-tier phone profile (4× CPU slowdown, ~9 Mbps / 60 ms):
 * LCP, CLS, total blocking time (long tasks beyond 50 ms) and JavaScript transferred per route.
 *
 *   pnpm build && pnpm start -p 3001 & node scripts/vitals.mjs     (VITALS_BASE overrides http://localhost:3001)
 */
import { chromium } from "@playwright/test";

const base = process.env.VITALS_BASE ?? "http://localhost:3001";
const routes = (process.argv[2] ?? "/,/fairness,/developers,/markets?demo=1,/trade/aNVDA?demo=1,/portfolio?demo=1,/brand").split(",");
const b = await chromium.launch();
const rows = [];
for (const r of routes) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (2 * 1024 * 1024) / 8 });
  let js = 0;
  p.on("response", async (res) => {
    if (res.request().resourceType() === "script") {
      const len = Number(res.headers()["content-length"] ?? 0);
      js += len || (await res.body().catch(() => Buffer.alloc(0))).length;
    }
  });
  await p.addInitScript(() => {
    const w = window;
    w.__v = { lcp: 0, cls: 0, tbt: 0 };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.__v.lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (w.__v.cls += e.value))).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.__v.tbt += Math.max(0, e.duration - 50)))).observe({ type: "longtask", buffered: true });
  });
  await p.goto(`${base}${r}`, { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(2500);
  const v = await p.evaluate(() => window.__v);
  rows.push({ route: r, lcpMs: Math.round(v.lcp), cls: +v.cls.toFixed(3), tbtMs: Math.round(v.tbt), jsKB: Math.round(js / 1024) });
  await ctx.close();
}
await b.close();
console.table(rows);
