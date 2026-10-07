/**
 * Records the live product for the film, on Monad mainnet. A passkey account (a CDP virtual authenticator, as Face ID
 * would be) is created on www.unisonfi.com. It is funded off camera from the team's agent wallet through MetaMask's
 * `mm` (approve, then depositFor), sells WMON in a sealed auction, and opens its certificate and receipt.
 *
 * Frames come from Chrome's own screencast, one folder per segment, each frame named by its timestamp. The places
 * clicked are logged, so the film can draw a cursor. `node capture/encode.mjs` turns each segment into an MP4.
 *
 * The passkey's credential, with its private key, is saved to .secrets/film-passkey.json (gitignored), so the
 * account's funds can always be recovered.
 *
 *   node capture/live.mjs            (from video/; needs `mm` signed in, and the agent wallet holding WMON)
 *   RESUME=1 node capture/live.mjs   reuse the saved passkey account; fund it only if its balance is short
 *   ONLY=create node capture/live.mjs   just the sign-up take, with a new passkey (an address derived from it, no tx)
 *   ONLY=signin node capture/live.mjs   just the sign-in take: the film's own passkey, "I already have one"
 *   SIDE=buy RESUME=1 node capture/live.mjs   buy instead, with the account's own AUSD: nothing funded, no `mm`
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createPublicClient, encodeFunctionData, erc20Abi, http, parseAbi, parseEther } from "viem";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "footage", "live");
const SECRETS = join(ROOT, "..", ".secrets");
const SITE = process.env.SITE ?? "https://www.unisonfi.com";
const QTY = process.env.QTY ?? "9";
/** sell (WMON funded from the agent wallet) or buy (with the AUSD the account already holds) */
const SIDE = process.env.SIDE === "buy" ? "buy" : "sell";
const Side = SIDE === "buy" ? "Buy" : "Sell";
/** DSF=2 captures at twice the pixel density (3840 × 2160 frames, the same 1920 × 1080 page): crisp when the film zooms */
const DSF = Number(process.env.DSF ?? 1);
const EXCHANGE = "0x1696170d40E703F1378989383c21Ec96ED1Adf75";
const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
const chain = createPublicClient({ transport: http("https://rpc.monad.xyz") });
const exchangeAbi = parseAbi(["function depositFor(address account, address token, uint256 amount)", "function balanceOf(address account, address token) view returns (uint256)"]);
const wmonAbi = parseAbi(["function deposit() payable"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SAVED = join(SECRETS, "film-passkey.json");
const saved = existsSync(SAVED) ? JSON.parse(readFileSync(SAVED, "utf8")) : null;
/** ONLY=create or ONLY=signin records just that take of the sign-in, and nothing moves on chain */
const ONLY = process.env.ONLY ?? null;
if (ONLY && !["create", "signin"].includes(ONLY)) throw new Error(`ONLY is create or signin, not ${ONLY}`);
if (ONLY === "signin" && !saved) throw new Error("no saved film passkey to sign in with");
const resume = !ONLY && process.env.RESUME === "1" ? saved : null;
// a fresh run would replace the film account's credential, and with it the way back to its funds
if (!ONLY && !resume && saved) throw new Error(".secrets/film-passkey.json exists: run with RESUME=1, or move it aside first");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** The globally installed `mm`, run through node itself so arguments arrive exactly as given (no shell quoting). */
const MM = process.env.MM_ENTRY ?? join(dirname(process.execPath), "node_modules", "@metamask", "agent-wallet", "dist", "index.js");

/** One transaction from the agent wallet, through MetaMask's own CLI. */
function mm(to, data, intent, value = "0x0") {
  const payload = JSON.stringify({ to, data, value });
  const out = execFileSync(process.execPath, [MM, "wallet", "send-transaction", "--chain-id", "143", "--payload", payload, "--wait", "--intent", intent, "--json"], { encoding: "utf8" });
  // mm prints notices, then its result as one pretty-printed object: parse from the last line that opens one
  const lines = out.trim().split("\n");
  let result = {};
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try {
      result = JSON.parse(lines.slice(i).join("\n"));
      break;
    } catch {
      // a brace inside a notice, not the result
    }
  }
  if (!result.ok) throw new Error(`mm failed: ${out.slice(0, 400)}`);
  log(`mm: ${intent}`);
  return result;
}

// each segment replaces only its own folder, so a resumed run keeps what earlier runs recorded
mkdirSync(OUT, { recursive: true });
mkdirSync(SECRETS, { recursive: true });

// headless Chrome draws its screencast at the page's CSS size unless the device scale is forced at launch too
const browser = await chromium.launch({ args: DSF > 1 ? [`--force-device-scale-factor=${DSF}`] : [] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: DSF, colorScheme: "dark" });
await ctx.addInitScript((identity) => {
  localStorage.setItem("unison.theme", "dark");
  localStorage.setItem("unison.tour.v1", "done");
  if (identity) localStorage.setItem("unison.identity.mainnet", identity);
}, resume?.identity ?? null);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
// signed in (a resumed run), or signed out with the passkey on the device (the sign-in take)
for (const credential of (ONLY === "signin" ? saved : resume)?.credentials ?? []) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });

// the screencast: every frame Chrome paints, saved with its timestamp; clicks logged for the film's cursor
let segment = null;
let events = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  if (segment) writeFileSync(join(OUT, segment, `${metadata.timestamp.toFixed(3)}.jpg`), Buffer.from(data, "base64"));
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
async function record(name) {
  segment = name;
  events = [];
  rmSync(join(OUT, name), { recursive: true, force: true });
  mkdirSync(join(OUT, name), { recursive: true });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: DSF > 1 ? 88 : 92, maxWidth: 1920 * DSF, maxHeight: 1080 * DSF, everyNthFrame: 1 });
  log(`recording ${name}`);
}
async function stop() {
  await cdp.send("Page.stopScreencast");
  writeFileSync(join(OUT, segment, "events.json"), JSON.stringify(events, null, 2));
  // the page's own size (clicks are in its pixels) and the density the frames were drawn at
  writeFileSync(join(OUT, segment, "meta.json"), JSON.stringify({ viewport: { width: 1920, height: 1080 }, dsf: DSF }));
  log(`stopped ${segment}`);
  segment = null;
}
/** Moves the mouse to a control as a person would, logs where, and clicks it. */
async function press(locator, label) {
  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 18 });
    events.push({ t: Date.now() / 1000, x, y, label });
  }
  await locator.click();
}

try {
  // 1. arrive: the WMON market on mainnet
  await page.goto(`${SITE}/trade/WMON?network=mainnet`, { waitUntil: "domcontentloaded" });
  await page.getByText(/^Monad mainnet$/).first().waitFor({ timeout: 45_000 });
  await page.getByRole("button", { name: /^(Cross|Last|Ref|Close) \$/ }).first().waitFor({ timeout: 45_000 });
  await sleep(1500);
  if (!ONLY) {
    await record("01-arrive");
    await sleep(4000);
    await stop();
  }

  // 2. a passkey account: no seed phrase, no extension. Created (a resumed run already has one), or, in the
  // sign-in take, the film's own passkey signing back in: the account that then sells.
  if (!resume) {
    const take = ONLY === "signin" ? "02-signin" : ONLY === "create" ? "02-create" : "02-passkey";
    await record(take);
    await press(page.getByRole("button", { name: "Sign in", exact: true }), "Sign in");
    await sleep(900);
    if (ONLY === "signin") await press(page.getByRole("button", { name: "I already have one" }), "I already have one");
    else await press(page.getByRole("button", { name: "Create a passkey" }), "Create a passkey");
    await page.getByText("Your account.").waitFor({ timeout: 90_000 });
    await sleep(2500);
    await stop();
  }

  // off camera: keep the credential (a new account's goes to its own file: the film's is never overwritten)
  const identity = await page.evaluate(() => localStorage.getItem("unison.identity.mainnet"));
  const account = identity ? JSON.parse(identity).account : null;
  if (!account) throw new Error("no passkey account in localStorage");
  if (ONLY === "signin" && account.toLowerCase() !== saved.account.toLowerCase()) throw new Error(`signed in as ${account}, not the film's ${saved.account}`);
  if (!resume && ONLY !== "signin") {
    const file = ONLY === "create" ? "film-passkey-create.json" : "film-passkey.json";
    const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
    writeFileSync(join(SECRETS, file), JSON.stringify({ site: SITE, network: "mainnet", account, created: new Date().toISOString(), identity, credentials }, null, 2));
    log(`account ${account}; credential saved to .secrets/${file}`);
  }
  if (ONLY) log(`${ONLY} take recorded as ${account}`);
  if (!ONLY) {
    const amount = parseEther(QTY);
    const held = SIDE === "sell" ? await chain.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "balanceOf", args: [account, WMON] }) : amount;
    if (held < amount) {
      const need = amount - held;
      const AGENT = process.env.AGENT ?? "0x5e986ec96d2979f278814452ad08c33c3c0aea4b";
      // the agent wallet holds MON: wrap exactly the WMON it lacks (WMON.deposit is payable)
      const inWallet = await chain.readContract({ address: WMON, abi: erc20Abi, functionName: "balanceOf", args: [AGENT] });
      if (inWallet < need) mm(WMON, encodeFunctionData({ abi: wmonAbi, functionName: "deposit" }), `Unison film: wrap the MON the film's account needs into WMON`, `0x${(need - inWallet).toString(16)}`);
      const allowance = await chain.readContract({ address: WMON, abi: erc20Abi, functionName: "allowance", args: [AGENT, EXCHANGE] });
      if (allowance < need) mm(WMON, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [EXCHANGE, need] }), `Unison film: let the exchange take exactly the WMON the film's account needs`);
      mm(EXCHANGE, encodeFunctionData({ abi: exchangeAbi, functionName: "depositFor", args: [account, WMON, need] }), `Unison film: deposit WMON for the film's passkey account`);
    }
    for (let i = 0; i < 60 && SIDE === "sell"; i++) {
      const bal = await chain.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "balanceOf", args: [account, WMON] });
      if (bal >= amount) break;
      await sleep(2000);
    }
    await page.keyboard.press("Escape");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^(Cross|Last|Ref|Close) \$/ }).first().waitFor({ timeout: 45_000 });
    await sleep(2500);

    // 3. the trade, sealed: its price doesn't exist yet. The limit sits at the band's edge, half a percent past the
    // reference (under it to sell, over it to buy), so it fills unless Chainlink's next price moves about 0.3% the
    // wrong way; if it doesn't, the order comes back and the take is redone.
    let sold = false;
    for (let attempt = 1; attempt <= 3 && !sold; attempt++) {
      await record(`03-${SIDE}`);
      await sleep(800);
      // a buy is the ticket's own default
      if (SIDE === "sell") await press(page.getByRole("radio", { name: /^sell$/i }).first(), "Sell");
      await sleep(600);
      // the reference chip is left out when it equals another chip's price
      const refChip = page.getByRole("button", { name: /^(Ref|Close) \$/ }).first();
      const chip = (await refChip.count()) > 0 ? refChip : page.getByRole("button", { name: /^(Bid|Last|Cross) \$/ }).first();
      await press(chip, "the reference");
      const ref = Number((await chip.innerText()).replace(/[^\d.]/g, ""));
      const limit = page.locator('input[name="limit"]:visible');
      await limit.fill((SIDE === "sell" ? Math.ceil(ref * 0.995 * 1e6) / 1e6 : Math.floor(ref * 1.005 * 1e6) / 1e6).toFixed(6));
      await limit.press("Enter");
      const qty = page.locator('input[name="qty"]:visible');
      await press(qty, "quantity");
      await qty.fill(QTY);
      await sleep(700);
      await press(page.getByRole("button", { name: new RegExp(`^${Side} ${QTY} WMON at`) }), Side);
      // all of a holding takes a second, explicit tap (the ticket's fat-finger guard)
      const confirm = page.getByRole("button", { name: /^Confirm: / });
      if (await confirm.waitFor({ timeout: 2000 }).then(() => true, () => false)) {
        await sleep(600);
        await press(confirm, "Confirm");
      }
      const sealedAt = Date.now();
      const outcome = page.locator("[data-sonner-toast]").filter({ hasText: /Sold|Bought|Not filled|Resting at/ }).first();
      await outcome.waitFor({ timeout: 180_000 });
      const said = (await outcome.innerText()).replace(/\s+/g, " ");
      log(`attempt ${attempt}: outcome after ${((Date.now() - sealedAt) / 1000).toFixed(1)} s: ${said}`);
      await sleep(2500);
      await stop();
      sold = /^(Sold|Bought)/.test(said);
      if (!sold) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: /^(Cross|Last|Ref|Close) \$/ }).first().waitFor({ timeout: 45_000 });
        await sleep(2500);
      }
    }
    if (!sold) throw new Error(`the ${SIDE} didn't fill in 3 auctions`);

    // 4. the certificate
    await record("04-certificate");
    await press(page.getByRole("tab", { name: "Fills" }), "Fills");
    await sleep(900);
    await press(page.getByRole("button", { name: /^Certificate for/ }).first(), "Certificate");
    await page.getByText(/receipt chain|could not verify/).waitFor({ timeout: 45_000 });
    await sleep(5000);
    const dialog = await page.getByRole("dialog").innerText().catch(() => "");
    writeFileSync(join(OUT, "04-certificate", "certificate.txt"), dialog);
    await stop();

    // 5. the receipt page of its auction
    const prints = await (await fetch("https://unison-tape-mainnet-production.up.railway.app/v1/markets/1/prints?limit=3&traded=1")).json();
    const print = prints.prints?.[0];
    if (print) {
      await page.goto(`${SITE}/receipt/mainnet/1/${print.upTo}`, { waitUntil: "domcontentloaded" });
      await sleep(2500);
      await record("05-receipt");
      await sleep(3000);
      // then down to "Check it yourself": the commands that rebuild this auction from the chain alone (its heading
      // clear of the sticky header)
      await page
        .getByText("Check it yourself")
        .first()
        .evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: "smooth" }));
      await sleep(4500);
      await stop();
      writeFileSync(join(OUT, "05-receipt", "print.json"), JSON.stringify(print, null, 2));
      log(`receipt: ${SITE}/receipt/mainnet/1/${print.upTo} (tx ${print.tx})`);
    }
  }
} catch (e) {
  if (segment) await stop().catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
