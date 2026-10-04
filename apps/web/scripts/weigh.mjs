/**
 * The scales: what each route makes a first visit download, gzipped, against the budgets, and what that weight is
 * made of. Reads the output of `next build` (route-bundle-stats.json); attribution needs the build's source maps.
 *
 *   node scripts/weigh.mjs                          every route against its budget
 *   SOURCE_MAPS=1 pnpm build && node scripts/weigh.mjs / /trade/[symbol]     and what those routes are made of
 *   node scripts/weigh.mjs / --by file --top 40     by source file instead of by package or folder
 *   node scripts/weigh.mjs --check                  exit 1 when a route is over budget (CI)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : fallback;
};
const check = flag("check", false) === true;
const top = Number(flag("top", 18));
const by = flag("by", "package");
// Git Bash rewrites "/trade" into "C:/Program Files/Git/trade"; undo it.
const detail = args
  .filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--top", "--by"].includes(args[i - 1])))
  .map((a) => "/" + a.replace(/^[A-Z]:\/.*\/Git\//i, "").replace(/^\/+/, ""));

/** Budgets in gzip KB (plan §4.5): the site persuades, the app operates. The component lab is not budgeted. */
const APP = ["/trade/[symbol]", "/markets", "/portfolio", "/vaults", "/vaults/[symbol]", "/keys"];
const budgetFor = (route) => (APP.includes(route) ? 250 : route === "/lab" ? null : 180);

const statsFile = join(root, ".next", "diagnostics", "route-bundle-stats.json");
if (!existsSync(statsFile)) {
  console.error("No build found: run `pnpm build` first.");
  process.exit(2);
}
const stats = JSON.parse(readFileSync(statsFile, "utf8"));
const gzCache = new Map();
const gzipOf = (p) => {
  if (!gzCache.has(p)) gzCache.set(p, gzipSync(readFileSync(join(root, p)), { level: 9 }).length);
  return gzCache.get(p);
};
const kb = (n) => (n / 1024).toFixed(1).padStart(6);

let over = 0;
const rows = stats
  .filter((r) => r.firstLoadChunkPaths?.length)
  .map((r) => ({ route: r.route, chunks: r.firstLoadChunkPaths, raw: r.firstLoadUncompressedJsBytes, gzip: r.firstLoadChunkPaths.reduce((s, p) => s + gzipOf(p), 0) }))
  .sort((a, b) => b.gzip - a.gzip);
console.log(`${"route".padEnd(20)} ${"gzip KB".padStart(8)} ${"raw KB".padStart(8)}  budget`);
for (const r of rows) {
  const budget = budgetFor(r.route);
  const bad = budget !== null && r.gzip / 1024 > budget;
  if (bad) over++;
  console.log(`${r.route.padEnd(20)} ${kb(r.gzip).padStart(8)} ${kb(r.raw).padStart(8)}  ${budget === null ? "  -" : `${String(budget).padStart(3)} ${bad ? "OVER" : "ok"}`}`);
}

const B64 = Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]));
/** Decode one source-map segment's VLQ fields. */
function vlq(s) {
  const out = [];
  let value = 0;
  let shift = 0;
  for (const ch of s) {
    const d = B64[ch];
    value += (d & 31) << shift;
    if (d & 32) shift += 5;
    else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/** Characters of generated code per original source, for one chunk: each segment owns the code up to the next one. */
function attribute(chunkPath) {
  const code = readFileSync(join(root, chunkPath), "utf8");
  // Turbopack hashes maps on their own; the chunk names its map in the trailing comment.
  const url = code.match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1];
  const mapPath = url ? join(root, chunkPath, "..", url) : null;
  const owned = new Map();
  const add = (k, n) => n > 0 && owned.set(k, (owned.get(k) ?? 0) + n);
  if (!mapPath || !existsSync(mapPath)) {
    add("(no source map)", code.length);
    return { owned, chars: code.length };
  }
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  const lines = code.split("\n");
  let src = 0;
  map.mappings.split(";").forEach((line, li) => {
    const text = lines[li] ?? "";
    let col = 0;
    let at = 0;
    let owner = "(runtime glue)";
    for (const seg of line ? line.split(",") : []) {
      const f = vlq(seg);
      col += f[0];
      add(owner, col - at);
      at = col;
      if (f.length >= 4) {
        src += f[1];
        owner = map.sources[src];
      } else owner = "(runtime glue)";
    }
    add(owner, text.length - at);
  });
  return { owned, chars: code.length };
}

/** Group a source path by package (node_modules), workspace package, or app folder; or keep the file. */
function keyOf(source) {
  const p = source.replace(/^turbopack:\/\/\/?/, "").replace(/^\[project\]\//, "");
  if (by === "file") return p.replace(/^.*node_modules\/(?!.*node_modules\/)/, "~").replace(/^apps\/web\//, "");
  const pkg = p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/);
  if (pkg) return pkg[1];
  const ws = p.match(/^packages\/([^/]+)\//);
  if (ws) return `@unison/${ws[1]}`;
  return p.replace(/^apps\/web\//, "").split("/").slice(0, 2).join("/");
}

for (const route of detail) {
  const row = rows.find((r) => r.route === route);
  if (!row) {
    console.error(`\n${route}: not in the build`);
    continue;
  }
  const groups = new Map();
  let mapped = 0;
  for (const chunk of row.chunks) {
    const { owned, chars } = attribute(chunk);
    const gz = gzipOf(chunk);
    for (const [src, n] of owned) {
      const k = src.startsWith("(") ? src : keyOf(src);
      groups.set(k, (groups.get(k) ?? 0) + (n / chars) * gz);
      if (!src.startsWith("(")) mapped += (n / chars) * gz;
    }
  }
  console.log(`\n${route}: ${kb(row.gzip).trim()} KB gzip in ${row.chunks.length} chunks, ${((mapped / row.gzip) * 100).toFixed(0)}% attributed (gzip shared out by raw size)`);
  for (const [k, v] of [...groups].sort((x, y) => y[1] - x[1]).slice(0, top)) console.log(`  ${kb(v)}  ${k}`);
}

if (check && over) {
  console.error(`\n${over} route(s) over budget`);
  process.exit(1);
}
