/**
 * Mainnet, the way a stranger meets it. Read-only by default: the venue switch reaches Monad mainnet, its markets
 * list only what it really lists (no simulation beside real assets), a market it doesn't list says so, and the
 * About panel names Chainlink as the price source.
 *
 * REHEARSAL=1 adds the money path, on a fork of mainnet only (FORK_RPC must be a local anvil fork, whose
 * accounts are unlocked): a passkey account, a deposit from a browser wallet (an injected EIP-1193 provider backed
 * by the fork's unlocked account), a buy of 0.01 aNVDA, its fill and its certificate. It refuses any non-local RPC,
 * so it can never spend real funds.
 *
 *   node scripts/flow-mainnet.mjs
 *   REHEARSAL=1 FORK_RPC=http://127.0.0.1:8547 WALLET=0x9965… node scripts/flow-mainnet.mjs
 */
import { chromium } from "@playwright/test";

const base = process.env.SHOOT_BASE ?? "http://localhost:3000";
const rehearsal = process.env.REHEARSAL === "1";
const rpc = process.env.FORK_RPC ?? "";
const wallet = process.env.WALLET ?? "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"; // anvil account 5
if (rehearsal && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(rpc)) {
  console.error("REHEARSAL=1 runs on a local fork only: set FORK_RPC=http://127.0.0.1:<port>");
  process.exit(2);
}
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

const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
await ctx.addInitScript(() => {
  localStorage.setItem("unison.theme", "light");
  localStorage.setItem("unison.tour.v1", "done");
});
if (rehearsal) {
  // a browser wallet: the fork's unlocked account, signing through the fork itself
  await ctx.addInitScript(
    ({ rpc, wallet }) => {
      const call = async (method, params) => {
        const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? [] }) });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
        return j.result;
      };
      window.ethereum = {
        isMetaMask: true,
        request: async ({ method, params }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [wallet];
          if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
          return call(method, params);
        },
        on() {},
        removeListener() {},
      };
    },
    { rpc, wallet },
  );
}
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const shot = (n) => (shots ? p.screenshot({ path: `brand/shots/mainnet-${n}.png` }) : Promise.resolve());

await p.goto(`${base}/markets?network=mainnet`, { waitUntil: "domcontentloaded" });
await check("the venue switch is on Monad mainnet", async () => {
  await p.getByText(/^Monad mainnet$/).first().waitFor({ timeout: 30_000 });
});
await check("mainnet lists only the markets it really lists", async () => {
  await p.getByRole("link", { name: /aNVDA/ }).first().waitFor({ timeout: 15_000 });
  const rows = await p.locator("main ul > li").count();
  if (rows > 3) throw new Error(`${rows} markets listed`);
  if (await p.getByText("aAAPL", { exact: true }).count()) throw new Error("an unlisted market is shown");
  await shot("1-markets");
});
await check("a market mainnet doesn't list says so, and offers practice", async () => {
  await p.goto(`${base}/trade/aAAPL`, { waitUntil: "domcontentloaded" });
  await p.getByRole("heading", { name: "aAAPL isn't on mainnet yet." }).waitFor({ timeout: 30_000 });
});
await p.goto(`${base}/trade/aNVDA`, { waitUntil: "domcontentloaded" });
await check("aNVDA's About panel names Chainlink, and no Unison key", async () => {
  const facts = p.locator('section[aria-labelledby="facts-title"]');
  await facts.waitFor({ timeout: 30_000 });
  await facts.getByText(/Chainlink's tokenized-equity feed/).waitFor({ timeout: 15_000 });
  // the beta read the latest round at the clear; the causal rule (SPEC §7.4) reads the first observation after the orders
  await facts.getByText(/No Unison key signs it|no trader, keeper or Unison key can choose another/).waitFor();
  await facts.getByText(/Monad mainnet, with real assets/).waitFor();
  await shot("2-trade");
});

if (rehearsal) {
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await check("rehearsal: a passkey account", async () => {
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await p.getByRole("button", { name: "Create a passkey" }).click();
    await p.getByText("Your account.").waitFor({ timeout: 60_000 });
  });
  await check("rehearsal: deposit 20 AUSD from a browser wallet", async () => {
    await p.getByRole("button", { name: "Deposit from a wallet" }).click();
    const d = p.getByRole("dialog", { name: "Deposit" });
    await d.getByRole("button", { name: "Connect a wallet" }).click();
    await d.getByText(/in your wallet$/).waitFor({ timeout: 30_000 });
    await d.getByRole("textbox").fill("20");
    await d.getByRole("button", { name: "Deposit AUSD" }).click();
    await p.locator("[data-sonner-toast]").filter({ hasText: "Deposited 20 AUSD" }).waitFor({ timeout: 120_000 });
    await shot("3-deposited");
  });
  await check("rehearsal: buy 0.01 aNVDA, filled by the vault, with a certificate", async () => {
    await p.getByRole("button", { name: /^(Cross|Last|Ref|Close) \$/ }).first().waitFor({ timeout: 30_000 });
    const limit = p.locator('input[name="limit"]:visible');
    const from = Number(await limit.inputValue());
    await limit.fill((from * 1.005).toFixed(2));
    await limit.press("Enter");
    await p.locator('input[name="qty"]:visible').fill("0.01");
    await p.getByRole("button", { name: /^Buy 0\.01 aNVDA at/ }).click();
    await p.locator("[data-sonner-toast]").filter({ hasText: /Bought|Resting at/ }).first().waitFor({ timeout: 120_000 });
    await p.getByRole("tab", { name: "Fills" }).click();
    await p.getByRole("button", { name: /^Certificate for buying/ }).first().click({ timeout: 60_000 });
    await p.getByText(/receipt chain|could not verify/).waitFor({ timeout: 30_000 });
    await shot("4-certificate");
  });
}

if (errors.length) results.push(`FAIL page errors: ${errors.slice(0, 3).join(" | ")}`);
await b.close();
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
