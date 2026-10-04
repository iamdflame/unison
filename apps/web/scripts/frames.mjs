/**
 * What the browser's renderer does while a route sits still after load: a devtools timeline trace under the vitals
 * phone profile (4× CPU), summed by event (style recalc, layout, paint, raster, composite, script) plus the long
 * tasks. A page at rest should be nearly idle; steady style or paint work means something animates expensively.
 *
 *   pnpm start -p 3001 & node scripts/frames.mjs / --ms 4000 [--scroll 1800]
 *   node scripts/frames.mjs / --load       from navigation instead: each long task with what filled it
 */
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const route = "/" + (args[0] ?? "").replace(/^[A-Z]:\/.*\/Git\//i, "").replace(/^\/+/, "");
const base = process.env.VITALS_BASE ?? "http://localhost:3001";
const ms = Number(flag("ms", 4000));
const scroll = flag("scroll", null);
const width = Number(flag("width", 390));
const fromLoad = args.includes("--load");

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width, height: width <= 500 ? 844 : 900 }, deviceScaleFactor: width <= 500 ? 2 : 1, isMobile: width <= 500, hasTouch: width <= 500 });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const events = [];
cdp.on("Tracing.dataCollected", (e) => events.push(...e.value));
const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
const trace = () => cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink,cc,gpu", transferMode: "ReportEvents" });
if (fromLoad) {
  await trace();
  await p.goto(`${base}${route}`, { waitUntil: "load" });
} else {
  await p.goto(`${base}${route}`, { waitUntil: "load" });
  await p.waitForTimeout(1500); // let the load settle; measure the page at rest
  if (scroll) {
    await p.evaluate((y) => window.scrollTo(0, Number(y)), scroll);
    await p.waitForTimeout(800);
  }
  await trace();
}
await p.waitForTimeout(ms);
await cdp.send("Tracing.end");
await done;
await b.close();

const main = events.find((e) => e.name === "TracingStartedInBrowser")?.args?.data?.frames?.[0]?.processId;
const sum = new Map();
let tasks = 0;
let longTasks = 0;
let blocking = 0;
for (const e of events) {
  if (e.ph !== "X" || !e.dur) continue;
  const d = e.dur / 1000;
  if (e.name === "RunTask" && (!main || e.pid === main)) {
    tasks++;
    if (d > 50) {
      longTasks++;
      blocking += d - 50;
    }
  }
  if (["UpdateLayoutTree", "Layout", "Paint", "PrePaint", "Layerize", "RasterTask", "CompositeLayers", "FunctionCall", "TimerFire", "FireAnimationFrame", "EvaluateScript", "HitTest", "ParseHTML", "Commit", "UpdateLayer", "PaintImage", "Decode Image", "GPUTask", "ScrollLayer"].includes(e.name)) {
    sum.set(e.name, (sum.get(e.name) ?? 0) + d);
  }
}
console.log(`${route}${scroll ? ` @${scroll}px` : ""}: ${fromLoad ? `load + ${ms} ms` : `${ms} ms at rest`} (4× CPU): ${tasks} tasks, ${longTasks} over 50 ms, ${Math.round(blocking)} ms blocking`);
if (fromLoad) {
  // each long task, and the work inside it (events nested in its time span on the main thread)
  const longs = events.filter((e) => e.name === "RunTask" && e.ph === "X" && e.dur > 50_000 && (!main || e.pid === main)).sort((a, c) => a.ts - c.ts);
  const t0 = Math.min(...events.filter((e) => e.ts > 0).map((e) => e.ts));
  for (const t of longs) {
    const inner = new Map();
    for (const e of events) {
      if (e.ph !== "X" || e.tid !== t.tid || e.pid !== t.pid || e.ts < t.ts || e.ts + (e.dur ?? 0) > t.ts + t.dur || e === t) continue;
      if (!["EvaluateScript", "v8.compile", "v8.compileModule", "FunctionCall", "ParseHTML", "UpdateLayoutTree", "Layout", "Paint", "PrePaint", "Layerize", "Commit", "TimerFire", "FireAnimationFrame", "RunMicrotasks", "v8.parseOnBackground", "HitTest", "EventDispatch"].includes(e.name)) continue;
      const url = e.args?.data?.url ? ` ${String(e.args.data.url).replace(base, "").slice(-40)}` : "";
      const fn = e.args?.data?.functionName ? ` ${e.args.data.functionName}` : "";
      const key = `${e.name}${e.name === "EvaluateScript" || e.name === "FunctionCall" ? url + fn : ""}`;
      inner.set(key, (inner.get(key) ?? 0) + e.dur / 1000);
    }
    const parts = [...inner].sort((a, c) => c[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round(v)}`).join(" · ");
    console.log(`  @${Math.round((t.ts - t0) / 1000)} ms  ${Math.round(t.dur / 1000)} ms: ${parts}`);
  }
}
for (const [k, v] of [...sum].sort((a, c) => c[1] - a[1])) console.log(`  ${String(Math.round(v)).padStart(6)} ms  ${k}`);
