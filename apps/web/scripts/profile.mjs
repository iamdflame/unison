/**
 * Where a route spends its main thread while loading, by original source file. Records a CPU profile under the
 * vitals phone profile (4× CPU slowdown) and maps every sample back through the build's source maps, so the answer
 * reads "react-dom hydration", "OnePrice.tsx" or "lib/hero/feed.ts" rather than a minified chunk.
 *
 *   SOURCE_MAPS=1 pnpm build && pnpm start -p 3001 & node scripts/profile.mjs / --ms 6000 --top 25
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
const ms = Number(flag("ms", 6000));
const top = Number(flag("top", 25));

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

/** chunk URL → per generated line, sorted [column, source] pairs */
const maps = new Map();
function mapFor(url) {
  if (maps.has(url)) return maps.get(url);
  let m = null;
  const path = url.match(/\/_next\/(static\/chunks\/[^?#]+)/)?.[1];
  const file = path ? join(root, ".next", path) : null;
  if (file && existsSync(file)) {
    const ref = readFileSync(file, "utf8").match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1];
    const mapFile = ref ? join(file, "..", ref) : null;
    if (mapFile && existsSync(mapFile)) {
      const sm = JSON.parse(readFileSync(mapFile, "utf8"));
      let src = 0;
      m = sm.mappings.split(";").map((line) => {
        let col = 0;
        const segs = [];
        for (const seg of line ? line.split(",") : []) {
          const f = vlq(seg);
          col += f[0];
          if (f.length >= 4) {
            src += f[1];
            segs.push([col, sm.sources[src]]);
          }
        }
        return segs;
      });
    }
  }
  maps.set(url, m);
  return m;
}
function sourceAt(url, line, col) {
  const m = mapFor(url);
  if (!m) return url ? url.replace(base, "").replace(/\?.*$/, "") : "(native)";
  const segs = m[line] ?? [];
  let lo = 0;
  let hi = segs.length - 1;
  let hit = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid][0] <= col) {
      hit = segs[mid][1];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return (hit ?? "(unmapped)").replace(/^turbopack:\/\/\/?\[project\]\//, "").replace(/^.*node_modules\/(?!.*node_modules\/)/, "~").replace(/^apps\/web\//, "");
}

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// a first visit to the terminal is offered the guided tour (scripts/flow-tour.mjs); captures and flows skip it
await ctx.addInitScript(() => localStorage.setItem("unison.tour.v1", "done"));
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await p.goto(`${base}${route}`, { waitUntil: "load" });
await p.waitForTimeout(ms);
const { profile } = await cdp.send("Profiler.stop");
await b.close();

const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
let total = 0;
profile.samples.forEach((id, i) => {
  const dt = (profile.timeDeltas[i] ?? 0) / 1000;
  const n = nodes.get(id);
  const f = n.callFrame;
  const key =
    f.functionName === "(idle)" || f.functionName === "(program)" || f.functionName === "(garbage collector)"
      ? f.functionName
      : `${sourceAt(f.url, f.lineNumber, f.columnNumber)}`;
  self.set(key, (self.get(key) ?? 0) + dt);
  if (f.functionName !== "(idle)") total += dt;
});
console.log(`${route}: ${Math.round(total)} ms busy of ${ms} ms after load (4× CPU), self time by source:`);
for (const [k, v] of [...self].filter(([k]) => k !== "(idle)").sort((a, c) => c[1] - a[1]).slice(0, top)) {
  console.log(`  ${String(Math.round(v)).padStart(6)} ms  ${k}`);
}
