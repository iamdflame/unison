/**
 * Field-style vitals on a production build, under a mid-tier phone profile (4× CPU slowdown, ~9 Mbps / 60 ms):
 * LCP, CLS, total blocking time (long tasks beyond 50 ms) and JavaScript bytes on the wire, split into what the
 * page needed by its load event and what came after (lazy parts and Next's link prefetches, at idle).
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
  // a first visit to the terminal is offered the guided tour (scripts/flow-tour.mjs); captures and flows skip it
  await ctx.addInitScript(() => localStorage.setItem("unison.tour.v1", "done"));
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (2 * 1024 * 1024) / 8 });
  // bytes on the wire (compressed), per script, stamped with whether the page had finished loading
  const scripts = new Set();
  let loaded = false;
  let jsLoad = 0;
  let jsAfter = 0;
  cdp.on("Network.responseReceived", (e) => e.type === "Script" && scripts.add(e.requestId));
  cdp.on("Network.loadingFinished", (e) => {
    if (!scripts.has(e.requestId)) return;
    if (loaded) jsAfter += e.encodedDataLength;
    else jsLoad += e.encodedDataLength;
  });
  await p.addInitScript(() => {
    const w = window;
    w.__v = { lcp: 0, cls: 0, tbt: 0 };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.__v.lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (w.__v.cls += e.value))).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.__v.tbt += Math.max(0, e.duration - 50)))).observe({ type: "longtask", buffered: true });
  });
  await p.goto(`${base}${r}`, { waitUntil: "load" }).catch(() => {});
  loaded = true;
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.waitForTimeout(2500);
  const v = await p.evaluate(() => window.__v);
  rows.push({
    route: r,
    lcpMs: Math.round(v.lcp),
    cls: +v.cls.toFixed(3),
    tbtMs: Math.round(v.tbt),
    jsLoadKB: Math.round(jsLoad / 1024),
    jsAfterKB: Math.round(jsAfter / 1024),
  });
  await ctx.close();
}
await b.close();
console.table(rows);
