/**
 * Agent flow on the local devnet: a passkey account takes test funds and mints an agent key on /keys with one
 * passkey signature; the real MCP server, driven by an MCP client with that key, places, finds and cancels an
 * order (services/mcp/scripts/agent-e2e.mjs); the key is revoked in the browser; and the agent is refused after.
 *
 *   node scripts/flow-agents.mjs <out.json>
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

// The minted key is a secret (devnet or not): it goes to the temp directory, never into the repo, and the MCP
// step (run from services/mcp) gets an absolute path.
const out = resolve(process.argv[2] ?? join(tmpdir(), "unison-agent-key.json"));
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

await p.goto(`${base}/keys`, { waitUntil: "domcontentloaded" });
await p.getByText("Local devnet").waitFor({ timeout: 20_000 });
await p.getByRole("button", { name: "Sign in", exact: true }).first().click();
await p.getByRole("button", { name: "Create a passkey" }).click();
await p.getByText("Your account.").waitFor({ timeout: 30_000 });
await p.getByRole("button", { name: "Add test funds" }).click();
await p.getByText("Test funds deposited.").waitFor({ timeout: 60_000 });
const account = (await p.getByRole("dialog").locator(".font-mono").first().innerText()).trim();
await p.keyboard.press("Escape");

await p.getByRole("button", { name: "Mint key with passkey" }).click();
await p.getByRole("heading", { name: "Give it to your agent" }).waitFor({ timeout: 60_000 });
await p.getByRole("button", { name: "Show key" }).click();
const cli = await p.locator("pre").first().innerText();
const privateKey = /AGENT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/.exec(cli)?.[1];
await p.getByRole("heading", { name: "Your keys" }).waitFor({ timeout: 15_000 });
await p.waitForTimeout(3000);
await p.screenshot({ path: "brand/shots/agents-live-1.png", fullPage: true });
log.push(`account ${account}, key minted: ${!!privateKey}`);
writeFileSync(out, JSON.stringify({ account, privateKey }));

const agent = (env) =>
  spawnSync(process.execPath, ["scripts/agent-e2e.mjs", out], { cwd: "../../services/mcp", env: { ...process.env, ...env }, encoding: "utf8", timeout: 120_000 });
const run1 = agent({});
log.push(`agent (granted):
${run1.stdout}${run1.stderr ? `stderr: ${run1.stderr.slice(0, 400)}` : ""}`);

{
  const revoke = p.getByRole("button", { name: "Revoke" }).first();
  await revoke.click();
  await p.locator("[data-sonner-toast]").filter({ hasText: /Key revoked/ }).first().waitFor({ timeout: 60_000 });
  log.push("revoked");
  await p.waitForTimeout(3500);
  await p.screenshot({ path: "brand/shots/agents-live-2.png", fullPage: true });
}
const run2 = agent({ EXPECT: "rejected" });
log.push(`agent (revoked):
${run2.stdout}${run2.stderr ? `stderr: ${run2.stderr.slice(0, 400)}` : ""}`);
console.log(log.join("\n"));
await b.close();
