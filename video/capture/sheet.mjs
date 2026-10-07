/**
 * A contact sheet: a film's frames at the given seconds, small, on one page, with their times, for judging a cut's
 * pace and look at a glance. Renders the stills (bundling once), lays them out in a browser, and screenshots it.
 *
 *   node capture/sheet.mjs Ad 0 1 2 3 …        (from video/; writes out/sheet-<Composition>.png)
 *   node capture/sheet.mjs Demo 0:30 every=1  every second from 0 to 30
 */
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [id, ...args] = process.argv.slice(2);
if (!id || !args.length) throw new Error("usage: node capture/sheet.mjs <Composition> <seconds…> | <from>:<to> every=<s>");
const serveUrl = await bundle({ entryPoint: join(ROOT, "src", "index.ts"), publicDir: join(ROOT, "public") });
const composition = await selectComposition({ serveUrl, id, logLevel: "error" });
const total = composition.durationInFrames / composition.fps;
let times = args.filter((a) => !a.includes("=") && !a.includes(":")).map(Number);
const range = args.find((a) => a.includes(":"));
if (range) {
  const [a, b] = range.split(":").map(Number);
  const every = Number(args.find((x) => x.startsWith("every="))?.slice(6) ?? 1);
  times = [];
  for (let t = a; t <= Math.min(b, total - 0.02); t += every) times.push(Number(t.toFixed(2)));
}
const dir = join(ROOT, "out", "sheet");
mkdirSync(dir, { recursive: true });
const shots = [];
for (const sec of times) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(sec * composition.fps));
  const output = join(dir, `${id}-${sec}.jpg`);
  await renderStill({ serveUrl, composition, frame, output, imageFormat: "jpeg", jpegQuality: 80, scale: 0.25, logLevel: "error" });
  shots.push({ sec, data: readFileSync(output).toString("base64") });
}
const cols = 4;
const html = `<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},480px);gap:4px;padding:4px;font:16px monospace;color:#ddd">
${shots.map((s) => `<div style="position:relative"><img src="data:image/jpeg;base64,${s.data}" style="width:480px;height:270px;display:block"/><span style="position:absolute;left:6px;top:4px;background:#000a;padding:1px 6px">${s.sec}s</span></div>`).join("")}
</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cols * 484 + 4, height: 400 } });
await page.setContent(html);
const out = join(ROOT, "out", `sheet-${id}${range ? `-${range.replace(":", "-")}` : ""}.png`);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`${shots.length} frames of ${id} (${total.toFixed(1)} s) → ${out}`);
