/**
 * The shell's lazily loaded controls, used the way a person uses them: the phone menu, the light switch (by mouse
 * and by keyboard), ⌘K, and a toast from a paper order. Each one arrives after the page is interactive, so this
 * checks that a press always lands, including one made before the control's code has arrived.
 *
 *   node scripts/flow-shell.mjs      (SHOOT_BASE overrides http://localhost:3000)
 */
import { chromium } from "@playwright/test";

const base = process.env.SHOOT_BASE ?? "http://localhost:3000";
const b = await chromium.launch();
const results = [];
/** Until React has hydrated a server-rendered button, a press does nothing on any SSR page; wait for that first. */
const hydrated = (p, label) =>
  p.waitForFunction((l) => {
    const el = document.querySelector(`[aria-label="${l}"]`);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
  }, label, { timeout: 30_000 });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${String(e.message ?? e).split("\n")[0]}`);
  }
};

// Phone: the menu sheet opens and lists the sections.
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${base}/legal/terms`, { waitUntil: "domcontentloaded" });
  await hydrated(p, "Menu");
  await check("phone menu opens from a tap", async () => {
    await p.getByRole("button", { name: "Menu" }).tap();
    await p.getByRole("dialog").getByRole("link", { name: "Fairness" }).waitFor({ timeout: 30_000 }); // a cold server on CI
    await p.getByRole("button", { name: "Close" }).tap();
    await p.getByRole("dialog").waitFor({ state: "detached", timeout: 5_000 });
  });
  await ctx.close();
}

// Desktop: the light switch by mouse, then by keyboard.
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem("unison.theme", "light"));
  const p = await ctx.newPage();
  await p.goto(`${base}/legal/terms`, { waitUntil: "domcontentloaded" });
  await p.waitForLoadState("networkidle");
  await check("light switch: pick Night with the mouse", async () => {
    await p.getByRole("button", { name: "Appearance" }).click();
    await p.getByRole("menuitemradio", { name: /Night/ }).click();
    await p.waitForFunction(() => document.documentElement.dataset.theme === "night", null, { timeout: 5_000 });
  });
  await check("light switch: keyboard opens it and Escape returns focus", async () => {
    await p.getByRole("button", { name: "Appearance" }).focus();
    await p.keyboard.press("Enter");
    await p.getByRole("menu").waitFor({ timeout: 5_000 });
    await p.keyboard.press("Escape");
    await p.getByRole("menu").waitFor({ state: "hidden", timeout: 5_000 });
    const focused = await p.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    if (focused !== "Appearance") throw new Error(`focus went to ${focused}`);
  });
  await ctx.close();
}

// A press made before the menu's code has arrived still opens it (the standby button hands it over).
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.route(/ThemeMenuPopup|_next\/static\/chunks\/.*\.js/, async (route) => {
    // hold back only the menu's own chunk: the one that names its component
    const res = await route.fetch();
    const body = await res.text();
    if (body.includes("menuitemradio") || body.includes("RadioItemIndicator")) await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ response: res, body });
  });
  await p.goto(`${base}/legal/terms`, { waitUntil: "domcontentloaded" });
  await hydrated(p, "Appearance");
  await check("an early press on the light switch opens it once it arrives", async () => {
    const standby = await p.evaluate(() => !document.querySelector("[aria-label=Appearance]")?.hasAttribute("data-popup-open") && !document.querySelector("[aria-label=Appearance][aria-controls]"));
    if (!standby) throw new Error("the menu arrived before the press: the test did not exercise the handoff");
    await p.getByRole("button", { name: "Appearance" }).click();
    await p.getByRole("menu").waitFor({ timeout: 10_000 });
  });
  await ctx.close();
}

// The app: ⌘K finds a market and goes there; a paper order toasts.
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${base}/markets?demo=1`, { waitUntil: "domcontentloaded" });
  // the title is drawn by the server; wait for the shell itself to be live before pressing its shortcut
  await hydrated(p, "Search markets");
  await check("⌘K finds aTSLA and opens its terminal", async () => {
    await p.keyboard.press("Control+k");
    await p.getByPlaceholder("Search markets, pages…").fill("TSLA");
    await p.keyboard.press("Enter");
    await p.waitForURL(/\/trade\/aTSLA/, { timeout: 15_000 });
  });
  await check("a paper order shows its toast", async () => {
    await p.goto(`${base}/trade/aNVDA?demo=1`, { waitUntil: "domcontentloaded" });
    const buy = p.getByRole("button", { name: /^Buy [\d.]+ aNVDA at/ });
    await buy.waitFor({ timeout: 20_000 });
    await buy.click();
    await p.locator("[data-sonner-toast]").first().waitFor({ timeout: 15_000 });
  });
  await ctx.close();
}

await b.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
