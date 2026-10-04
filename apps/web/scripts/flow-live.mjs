/**
 * Live flow against the local devnet (scripts/dev-stack.mjs): a passkey created on a CDP virtual authenticator
 * (user-verifying, like Face ID) registers through the relayer, takes test funds from the faucet, and places a
 * passkey-signed order that the keeper clears on-chain.
 */
import { chromium } from "@playwright/test";

const base = process.env.SHOOT_BASE ?? "http://localhost:3000";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
await ctx.addInitScript(() => localStorage.setItem("unison.theme", "dark"));
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
const log = [];
p.on("pageerror", (e) => log.push(`pageerror: ${e.message}`));
p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && log.push(`${m.type()}: ${m.text()}`));
const shot = (n) => p.screenshot({ path: `brand/shots/live-${n}.png` });

await p.goto(`${base}/trade/aNVDA`, { waitUntil: "domcontentloaded" });
await p.getByText("Local devnet").waitFor({ timeout: 20_000 });
await shot("1-live");
await p.getByRole("button", { name: "Sign in", exact: true }).click();
await p.getByRole("button", { name: "Create a passkey" }).click();
await p.getByText("Your account.").waitFor({ timeout: 30_000 });
await shot("2-account");
await p.getByRole("button", { name: "Add test funds" }).click();
await p.getByText("Test funds deposited.").waitFor({ timeout: 60_000 });
await p.waitForTimeout(1500);
await shot("3-funded");
await p.keyboard.press("Escape");
// a marketable buy: from where the auction would clear now (or the last trade, or the band's centre), a little above
{
  await p.getByRole("button", { name: /^(Cross|Last|Ref|Close) \$/ }).first().waitFor();
  const cross = p.getByRole("button", { name: /^Cross \$/ });
  const last = p.getByRole("button", { name: /^Last \$/ });
  await ((await cross.count()) ? cross : (await last.count()) ? last : p.getByRole("button", { name: /^(Ref|Close) \$/ })).click();
  const limit = p.locator('input[name="limit"]:visible');
  await limit.fill((Number(await limit.inputValue()) + 0.5).toFixed(2));
  await limit.press("Enter");
}
await p.locator('input[name="qty"]:visible').fill("1");
await p.getByRole("button", { name: /^Buy 1 aNVDA at/ }).click();
await p.waitForTimeout(1500);
await shot("4-placed");
// The toast follows the order: the keeper clears the batch, auto-claims, and the tape pushes the fill.
const outcome = p.locator("[data-sonner-toast]").filter({ hasText: /Bought|Resting at|Not filled/ }).first();
const t0 = Date.now();
await outcome.waitFor({ timeout: 60_000 });
log.push(`toast after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${(await outcome.innerText()).replace(/\s+/g, " ")}`);
await shot("5-after");
await p.getByRole("tab", { name: "Fills" }).click();
await p.waitForTimeout(800);
const cert = p.getByRole("button", { name: /^Certificate for/ }).first();
if (await cert.isVisible().catch(() => false)) {
  await cert.click();
  await p.getByText(/receipt chain|could not verify/).waitFor({ timeout: 15_000 }).catch(() => log.push("certificate: no verification text"));
  await p.waitForTimeout(2200);
  log.push(`certificate: ${(await p.getByRole("dialog").innerText()).replace(/\s+/g, " ").slice(0, 400)}`);
  await shot("6-certificate");
} else log.push("no fills listed");
console.log(log.join("\n"));
await b.close();
