/**
 * What keeps a page busy when nobody touches it. A page at rest should be idle between beats; this names every
 * running animation (and whether the compositor could take it, with Chrome's reason when it couldn't) and every
 * requestAnimationFrame / timer call site, mapped back through the build's source maps.
 *
 *   SOURCE_MAPS=1 pnpm build && pnpm start -p 3001 & node scripts/rest.mjs / [--scroll 1800] [--width 1440]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1");
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const route = "/" + (args[0] ?? "").replace(/^[A-Z]:\/.*\/Git\//i, "").replace(/^\/+/, "");
const base = process.env.VITALS_BASE ?? "http://localhost:3001";
const width = Number(flag("width", 390));
const scroll = flag("scroll", null);
const ms = Number(flag("ms", 3000));

const B64 = Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]));
function vlq(s) {
  const out = [];
  let v = 0;
  let sh = 0;
  for (const ch of s) {
    const d = B64[ch];
    v += (d & 31) << sh;
    if (d & 32) sh += 5;
    else {
      out.push(v & 1 ? -(v >>> 1) : v >>> 1);
      v = 0;
      sh = 0;
    }
  }
  return out;
}
const maps = new Map();
/** "…/_next/static/chunks/x.js:1:2345" → "components/brand/ResonanceDial.tsx:131" */
function where(frame) {
  const m = frame.match(/(\/_next\/static\/chunks\/[^:]+):(\d+):(\d+)/);
  if (!m) return frame.replace(/^\s*at\s+/, "").slice(0, 100);
  const [, path, lineS, colS] = m;
  if (!maps.has(path)) {
    const file = join(root, ".next", path.replace("/_next/", ""));
    let parsed = null;
    if (existsSync(file)) {
      const ref = readFileSync(file, "utf8").match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1];
      const mf = ref ? join(file, "..", ref) : null;
      if (mf && existsSync(mf)) {
        const sm = JSON.parse(readFileSync(mf, "utf8"));
        let src = 0;
        let sl = 0;
        parsed = sm.mappings.split(";").map((line) => {
          let col = 0;
          const segs = [];
          for (const seg of line ? line.split(",") : []) {
            const f = vlq(seg);
            col += f[0];
            if (f.length >= 4) {
              src += f[1];
              sl += f[2];
              segs.push([col, sm.sources[src], sl + 1]);
            }
          }
          return segs;
        });
      }
    }
    maps.set(path, parsed);
  }
  const parsed = maps.get(path);
  if (!parsed) return `${path}:${lineS}:${colS}`;
  const segs = parsed[Number(lineS) - 1] ?? [];
  const col = Number(colS) - 1;
  let hit = null;
  for (const s of segs) if (s[0] <= col) hit = s;
  if (!hit) return `${path}:${lineS}:${colS}`;
  return `${hit[1].replace(/^turbopack:\/\/\/?\[project\]\//, "").replace(/^.*node_modules\/(?!.*node_modules\/)/, "~").replace(/^apps\/web\//, "")}:${hit[2]}`;
}

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width, height: width <= 500 ? 844 : 900 }, deviceScaleFactor: width <= 500 ? 2 : 1, isMobile: width <= 500, hasTouch: width <= 500 });
await ctx.addInitScript(() => {
  const w = window;
  w.__calls = new Map();
  const note = (kind, ms) => {
    const stack = (new Error().stack ?? "").split("\n");
    // the first frame outside this wrapper: whoever asked
    const frame = stack.slice(3).find((l) => l.includes("/_next/")) ?? stack[3] ?? "?";
    const key = `${kind}${ms === undefined ? "" : ` @${ms}ms`}\t${frame.trim()}`;
    w.__calls.set(key, (w.__calls.get(key) ?? 0) + 1);
  };
  const raf = w.requestAnimationFrame.bind(w);
  w.requestAnimationFrame = (cb) => (note("rAF"), raf(cb));
  const st = w.setTimeout.bind(w);
  w.setTimeout = (cb, ms, ...a) => (note("setTimeout", ms), st(cb, ms, ...a));
  const si = w.setInterval.bind(w);
  w.setInterval = (cb, ms, ...a) => (note("setInterval", ms), si(cb, ms, ...a));
});
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await p.goto(`${base}${route}`, { waitUntil: "load" });
await p.waitForTimeout(1500);
if (scroll) {
  await p.evaluate((y) => window.scrollTo(0, Number(y)), scroll);
  await p.waitForTimeout(800);
}
await p.evaluate(() => window.__calls.clear());
const events = [];
cdp.on("Tracing.dataCollected", (e) => events.push(...e.value));
const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink.animations", transferMode: "ReportEvents" });
await p.waitForTimeout(ms);
await cdp.send("Tracing.end");
await done;
const page = await p.evaluate(() => ({
  anims: document.getAnimations().map((a) => {
    const t = a.effect?.target;
    const props = a.effect?.getKeyframes?.().flatMap((k) => Object.keys(k).filter((x) => !["offset", "easing", "composite", "computedOffset"].includes(x))) ?? [];
    const label = t
      ? `${t.tagName.toLowerCase()}${t.id ? `#${t.id}` : ""}${t.getAttribute("class") ? `.${t.getAttribute("class").split(/\s+/).slice(0, 2).join(".")}` : ""} in ${t.closest("section")?.getAttribute("aria-labelledby") ?? t.closest("header,footer,nav")?.tagName.toLowerCase() ?? "page"}`
      : "?";
    return `${a.constructor.name}(${a.animationName || a.transitionProperty || [...new Set(props)].join(",")}) ${a.playState} :: ${label}`;
  }),
  calls: [...window.__calls],
}));
await b.close();

const failed = new Map();
for (const e of events) {
  const reasons = e.args?.data?.compositeFailed ?? e.args?.data?.unsupportedProperties;
  if (e.name === "Animation" && e.args?.data?.compositeFailed) {
    const key = `${e.args.data.compositeFailed}${e.args.data.unsupportedProperties ? ` (${e.args.data.unsupportedProperties.join(",")})` : ""} :: ${e.args.data.name ?? e.args.data.nodeName ?? ""}`;
    failed.set(key, (failed.get(key) ?? 0) + 1);
  } else if (reasons && e.name === "Animation") failed.set(String(reasons), (failed.get(String(reasons)) ?? 0) + 1);
}
const frames = events.filter((e) => e.name === "BeginMainThreadFrame" || e.name === "BeginFrame").length;
const group = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());

console.log(`${route}${scroll ? ` @${scroll}px` : ""} at ${width}px, ${ms} ms at rest: ${frames} frame begins`);
console.log("running animations:");
for (const [k, v] of group(page.anims)) console.log(`  ${v}× ${k}`);
if (!page.anims.length) console.log("  none");
console.log("not composited (Chrome's compositeFailed bits; see cc/animation/animation_host / blink CompositorAnimations):");
for (const [k, v] of failed) console.log(`  ${v}× ${k}`);
if (!failed.size) console.log("  none");
console.log("timer and frame requests:");
const calls = page.calls.map(([k, v]) => {
  const [kind, frame] = k.split("\t");
  return [`${kind.padEnd(22)} ${where(frame)}`, v];
});
for (const [k, v] of calls.sort((a, c) => c[1] - a[1]).slice(0, 15)) console.log(`  ${String(v).padStart(4)}  ${k}`);
if (!calls.length) console.log("  none");
