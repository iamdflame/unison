/**
 * Live portfolio flow on the local devnet: passkey account → test funds → a buy → the portfolio (equity, holdings,
 * fills) → a passkey-signed withdrawal to an anvil wallet → the transfer listed.
 */
import { chromium } from "@playwright/test";

const base = process.env.SHOOT_BASE ?? "http://localhost:3000";
const WALLET = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"; // anvil #9
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
await ctx.addInitScript(() => localStorage.setItem("unison.theme", "light"));
// a first visit to the terminal is offered the guided tour (scripts/flow-tour.mjs); captures and flows skip it
await ctx.addInitScript(() => localStorage.setItem("unison.tour.v1", "done"));
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
const log = [];
p.on("pageerror", (e) => log.push(`pageerror: ${e.message}`));
p.on("console", (m) => m.type() === "error" && log.push(`console: ${m.text()}`));
const shot = (n) => p.screenshot({ path: `brand/shots/portfolio-live-${n}.png`, fullPage: true });
const toast = (re) => p.locator("[data-sonner-toast]").filter({ hasText: re }).first();

await p.goto(`${base}/trade/aNVDA`, { waitUntil: "domcontentloaded" });
await p.getByText("Local devnet").waitFor({ timeout: 20_000 });
await p.getByRole("button", { name: "Sign in", exact: true }).click();
await p.getByRole("button", { name: "Create a passkey" }).click();
await p.getByText("Your account.").waitFor({ timeout: 30_000 });
await p.getByRole("button", { name: "Add test funds" }).click();
await p.getByText("Test funds deposited.").waitFor({ timeout: 60_000 });
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
await p.locator('input[name="qty"]:visible').fill("2");
await p.getByRole("button", { name: /^Buy 2 aNVDA at/ }).click();
await toast(/Bought|Resting at|Not filled/).waitFor({ timeout: 60_000 });
log.push(`trade: ${(await toast(/Bought|Resting at|Not filled/).innerText()).replace(/\s+/g, " ")}`);

await p.getByRole("link", { name: "Portfolio" }).first().click();
await p.getByRole("heading", { name: "Holdings" }).waitFor({ timeout: 20_000 });
await p.waitForTimeout(2500);
log.push(`equity: ${(await p.getByRole("region", { name: "Equity" }).innerText()).replace(/\s+/g, " ").slice(0, 160)}`);
await shot("1");

await p.getByRole("button", { name: "Withdraw", exact: true }).click();
await p.getByRole("textbox", { name: "Amount" }).fill("25");
await p.getByRole("textbox", { name: "To", exact: true }).fill(WALLET);
await p.getByRole("button", { name: "Withdraw with passkey" }).click();
await toast(/Withdrew/).waitFor({ timeout: 60_000 });
log.push(`withdraw: ${(await toast(/Withdrew/).innerText()).replace(/\s+/g, " ")}`);
await p.getByRole("tab", { name: "Transfers" }).click();
await p.getByText("Withdrawal").first().waitFor({ timeout: 20_000 }).catch(() => log.push("no withdrawal listed"));
await p.waitForTimeout(800);
log.push(`transfers: ${(await p.getByRole("tabpanel").innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
await shot("2");
console.log(log.join("\n"));
await b.close();
