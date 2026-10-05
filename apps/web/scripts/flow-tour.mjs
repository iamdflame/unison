/**
 * The guided tour, used the way a newcomer meets it: the invitation on a first visit, every stop in turn with its
 * light over the part it explains, the arrow keys, Done remembered (no second invitation after a reload), a replay
 * from ⌘K on another page ended with Esc, a replay from the terminal, and "Not now" remembered. On a desktop by night
 * and a phone by day.
 *
 *   node scripts/flow-tour.mjs      (SHOOT_BASE overrides http://localhost:3000; LIVE=1 uses the venue the site
 *                                    finds instead of the simulation; SHOTS=1 saves a frame of every stop)
 */
import { chromium } from "@playwright/test";

const base = process.env.SHOOT_BASE ?? "http://localhost:3000";
const q = process.env.LIVE === "1" ? "" : "?demo=1";
const shots = process.env.SHOTS === "1";
const b = await chromium.launch();
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${String(e.message ?? e).split("\n")[0]}`);
  }
};
const stored = (p) => p.evaluate(() => localStorage.getItem("unison.tour.v1"));
const card = (p) => p.locator("[data-tour-stop]");

/** How much of the lit element the light covers, once it has settled (the glide, and the page's scroll to it). */
const coverage = (p) =>
  p.evaluate(async () => {
    // past the glide, then still for three samples running
    const stable = async () => {
      await new Promise((r) => setTimeout(r, 600));
      let prev = "";
      let still = 0;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 60));
        const r = document.querySelector("[data-tour-light]").getBoundingClientRect();
        const key = [r.x, r.y, r.width, r.height].map(Math.round).join();
        still = key === prev ? still + 1 : 0;
        if (still >= 3) return r;
        prev = key;
      }
      return document.querySelector("[data-tour-light]").getBoundingClientRect();
    };
    const light = await stable();
    const anchor = document.querySelector("[data-tour-stop]").dataset.tourAnchor;
    if (!anchor) return { anchor: null, ratio: 1 };
    const el = [...document.querySelectorAll(`[data-tour="${anchor}"]`)].find((e) => e.getClientRects().length > 0);
    if (!el) return { anchor, ratio: 0 };
    const r = el.getBoundingClientRect();
    // only what is on screen can be lit: a part taller than the window is lit where it shows
    const vis = { x0: Math.max(r.left, 0), y0: Math.max(r.top, 0), x1: Math.min(r.right, innerWidth), y1: Math.min(r.bottom, innerHeight) };
    const area = Math.max(0, vis.x1 - vis.x0) * Math.max(0, vis.y1 - vis.y0);
    const ix = Math.max(0, Math.min(vis.x1, light.right) - Math.max(vis.x0, light.left));
    const iy = Math.max(0, Math.min(vis.y1, light.bottom) - Math.max(vis.y0, light.top));
    // and the light hugs it: no more than its padding wider on any side
    const snug = light.left >= vis.x0 - 12 && light.top >= vis.y0 - 12 && light.right <= vis.x1 + 12 && light.bottom <= vis.y1 + 12;
    return { anchor, ratio: area > 0 ? (ix * iy) / area : 0, snug };
  });

async function walk(p, tag) {
  const total = await p.evaluate(() => document.querySelector("[data-tour-stop]") && document.querySelectorAll("[data-tour-stop] ol li").length);
  const seen = [];
  for (let i = 0; i <= total; i++) {
    const c = card(p);
    const id = await c.getAttribute("data-tour-stop");
    const cov = await coverage(p);
    if (cov.ratio < 0.95 || cov.snug === false) throw new Error(`stop ${id}: the light covers ${(cov.ratio * 100).toFixed(0)}% of ${cov.anchor}${cov.snug === false ? ", and isn't snug" : ""}`);
    // the card never covers what it explains
    const overlap = await p.evaluate(() => {
      const a = document.querySelector("[data-tour-light]").getBoundingClientRect();
      const k = document.querySelector("[data-tour-stop]").getBoundingClientRect();
      if (!document.querySelector("[data-tour-stop]").dataset.tourAnchor) return 0;
      const ix = Math.max(0, Math.min(a.right, k.right) - Math.max(a.left, k.left));
      const iy = Math.max(0, Math.min(a.bottom, k.bottom) - Math.max(a.top, k.top));
      return (ix * iy) / Math.max(1, a.width * a.height);
    });
    if (overlap > 0.02) throw new Error(`stop ${id}: the card covers ${(overlap * 100).toFixed(0)}% of the light`);
    // inside the window, whole
    const box = await c.boundingBox();
    const vp = p.viewportSize();
    if (box.x < 0 || box.y < 0 || box.x + box.width > vp.width + 0.5 || box.y + box.height > vp.height + 0.5) throw new Error(`stop ${id}: the card leaves the window`);
    seen.push(id);
    if (shots) await p.screenshot({ path: `brand/shots/tour-${tag}-${i}-${id}.png` });
    if (i < total) {
      await c.getByRole("button", { name: /^(Start|Next)$/ }).click();
      await p.waitForFunction((prev) => document.querySelector("[data-tour-stop]")?.dataset.tourStop !== prev, id, { timeout: 5_000 });
    }
  }
  return seen;
}

for (const layout of [
  { tag: "desktop", viewport: { width: 1440, height: 900 }, theme: "dark" },
  { tag: "phone", viewport: { width: 390, height: 844 }, theme: "light", isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
]) {
  const ctx = await b.newContext({ viewport: layout.viewport, colorScheme: layout.theme, isMobile: layout.isMobile, hasTouch: layout.hasTouch, deviceScaleFactor: layout.deviceScaleFactor });
  await ctx.addInitScript((t) => localStorage.setItem("unison.theme", t), layout.theme);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const tag = layout.tag;

  await p.goto(`${base}/trade/aNVDA${q}`, { waitUntil: "domcontentloaded" });
  const invite = p.getByRole("region", { name: "Take the one-minute tour" });
  await check(`${tag}: a first visit is offered the tour`, async () => {
    await invite.waitFor({ timeout: 30_000 });
    if (shots) await p.screenshot({ path: `brand/shots/tour-${tag}-invite.png` });
  });
  await check(`${tag}: Take the tour opens it, with focus on Start`, async () => {
    await invite.getByRole("button", { name: "Take the tour" }).click();
    await p.getByRole("dialog", { name: "One price for everyone" }).waitFor({ timeout: 10_000 });
    await p.waitForFunction(() => document.activeElement?.textContent === "Start", null, { timeout: 3_000 });
    if (await invite.isVisible()) throw new Error("the invitation is still showing");
  });
  await check(`${tag}: every stop lights its part, and the card stays clear of it`, async () => {
    const seen = await walk(p, tag);
    const want = tag === "desktop" ? 9 : 8;
    if (seen.length !== want) throw new Error(`${seen.length} stops (${seen.join(", ")}), wanted ${want}`);
    if (tag === "phone" && seen.includes("outcome")) throw new Error("the phone tour lights the ticket's outcome, which is in the closed sheet");
  });
  await check(`${tag}: the page behind the tour is inert`, async () => {
    const inert = await p.evaluate(() => document.querySelector("main")?.closest("[inert]") !== null);
    if (!inert) throw new Error("the terminal still takes focus and clicks");
  });
  await check(`${tag}: ← goes back a stop, → forward again`, async () => {
    const at = await card(p).getAttribute("data-tour-stop");
    await p.keyboard.press("ArrowLeft");
    await p.waitForFunction((a) => document.querySelector("[data-tour-stop]")?.dataset.tourStop !== a, at, { timeout: 3_000 });
    await p.keyboard.press("ArrowRight");
    await p.waitForFunction((a) => document.querySelector("[data-tour-stop]")?.dataset.tourStop === a, at, { timeout: 3_000 });
  });
  await check(`${tag}: Done ends it, gives the page back, and is remembered`, async () => {
    await card(p).getByRole("button", { name: "Done" }).click();
    await card(p).waitFor({ state: "detached", timeout: 3_000 });
    const inert = await p.evaluate(() => document.querySelectorAll("[inert]").length);
    if (inert) throw new Error(`${inert} elements left inert`);
    if ((await stored(p)) !== "done") throw new Error(`stored ${await stored(p)}`);
  });
  await check(`${tag}: no second invitation after a reload`, async () => {
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.waitForTimeout(4_000);
    if (await invite.isVisible()) throw new Error("offered again");
  });
  if (tag === "desktop") {
    await check(`${tag}: ⌘K on another page replays it on the terminal, and Esc ends it`, async () => {
      await p.goto(`${base}/portfolio${q}`, { waitUntil: "networkidle" });
      await p.keyboard.press("Control+k");
      await p.getByPlaceholder("Search markets, pages…").fill("tour");
      await p.keyboard.press("Enter");
      await p.getByRole("dialog", { name: "One price for everyone" }).waitFor({ timeout: 15_000 });
      if (!new URL(p.url()).pathname.startsWith("/trade/")) throw new Error(`at ${p.url()}`);
      await card(p).getByRole("button", { name: "Start" }).click();
      await p.waitForFunction(() => document.querySelector("[data-tour-stop]")?.dataset.tourStop === "price", null, { timeout: 3_000 });
      await p.keyboard.press("Escape");
      await card(p).waitFor({ state: "detached", timeout: 3_000 });
      if ((await stored(p)) !== "dismissed") throw new Error(`stored ${await stored(p)}`);
    });
  } else {
    await check(`${tag}: the terminal's own link replays it`, async () => {
      await p.getByRole("button", { name: "Take the tour" }).click();
      await p.getByRole("dialog", { name: "One price for everyone" }).waitFor({ timeout: 10_000 });
      await card(p).getByRole("button", { name: "Skip tour" }).click();
      await card(p).waitFor({ state: "detached", timeout: 3_000 });
      // focus goes back to the link that opened it
      await p.waitForFunction(() => document.activeElement?.textContent === "Take the tour", null, { timeout: 3_000 });
    });
  }
  if (errors.length) results.push(`FAIL ${tag}: page errors: ${errors.slice(0, 3).join(" | ")}`);
  await ctx.close();
}

// "Not now" is remembered too.
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(`${base}/trade/aSPY${q}`, { waitUntil: "domcontentloaded" });
  await check("Not now declines it, and is remembered", async () => {
    const invite = p.getByRole("region", { name: "Take the one-minute tour" });
    await invite.waitFor({ timeout: 30_000 });
    await invite.getByRole("button", { name: "Not now" }).click();
    await invite.waitFor({ state: "detached", timeout: 3_000 });
    if ((await stored(p)) !== "dismissed") throw new Error(`stored ${await stored(p)}`);
  });
  await ctx.close();
}

await b.close();
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
