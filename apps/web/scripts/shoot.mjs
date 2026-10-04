/**
 * Design-review camera. Screenshots a route the way a reviewer sees it, in either light, at any width, optionally
 * after an interaction and as a frame sequence (motion QA; animations can be slowed through CDP).
 *
 *   node scripts/shoot.mjs /lab --theme night --width 1440 --full
 *   node scripts/shoot.mjs /lab --click "text=Strike the fork" --frames 6 --interval 90 --rate 0.25
 *   node scripts/shoot.mjs / --width 390 --reduced
 *
 * Output: brand/shots/<route>-<theme>-<width>[-n].png (gitignored), printed one per line.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
// Git Bash rewrites "/lab" into a Windows path; accept "lab" or "/lab" and undo MSYS conversion.
const route = "/" + (args[0] ?? "").replace(/^[A-Z]:\/.*\/Git\//i, "").replace(/^\/+/, "");
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : fallback;
};
const base = opt("base", process.env.SHOOT_BASE ?? "http://localhost:3000");
const theme = opt("theme", "day");
const width = Number(opt("width", 1440));
const height = Number(opt("height", width <= 500 ? 844 : 900));
const frames = Number(opt("frames", 1));
const interval = Number(opt("interval", 100));
const rate = Number(opt("rate", 1));
const click = opt("click", null);
const wait = Number(opt("wait", 600));
const scrollTo = opt("scroll", null);
const full = opt("full", false) === true;
const reduced = opt("reduced", false) === true;
const at = opt("at", null); // ISO instant to freeze the clock at (market-hours states)
const sections = opt("sections", null); // comma-separated selectors: scroll each into view and shoot the viewport

const dir = new URL("../brand/shots/", import.meta.url);
mkdirSync(dir, { recursive: true });
const slug = `${route.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "home"}-${theme}-${width}${reduced ? "-rm" : ""}`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: width <= 500 ? 3 : 1,
  reducedMotion: reduced ? "reduce" : "no-preference",
  colorScheme: theme === "night" ? "dark" : "light",
});
await context.addInitScript((mode) => {
  try {
    localStorage.setItem("unison.theme", mode);
  } catch {}
}, theme === "night" ? "dark" : theme === "day" ? "light" : "market");
const page = await context.newPage();
if (at) await page.clock.install({ time: new Date(at) });
const cdp = await context.newCDPSession(page);
await cdp.send("Animation.enable");
if (rate !== 1) await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));

await page.goto(base + route, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
if (scrollTo) await page.evaluate((y) => window.scrollTo(0, Number(y)), scrollTo);
await page.waitForTimeout(wait);
if (click) await page.locator(click).first().dispatchEvent("pointerdown");

const out = [];
if (sections) {
  for (const [i, sel] of String(sections).split(",").entries()) {
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80);
    }, sel);
    await page.waitForTimeout(wait);
    const file = new URL(`${slug}-s${i}.png`, dir);
    await page.screenshot({ path: file.pathname.replace(/^\/([A-Z]:)/, "$1") });
    out.push(file.pathname.replace(/^\/([A-Z]:)/, "$1"));
  }
  await browser.close();
  console.log(out.join("\n"));
  process.exit(0);
}
for (let i = 0; i < frames; i++) {
  if (i > 0) await page.waitForTimeout(interval);
  const file = new URL(`${slug}${frames > 1 ? `-${i}` : ""}.png`, dir);
  await page.screenshot({ path: file.pathname.replace(/^\/([A-Z]:)/, "$1"), fullPage: full });
  out.push(file.pathname.replace(/^\/([A-Z]:)/, "$1"));
}
await browser.close();
console.log(out.join("\n"));
