/**
 * Passkeys across the site's domains (WebAuthn Related Origin Requests), against the deployed site, on the testnet
 * with throwaway accounts:
 *
 *   A. a passkey made on the vercel.app alias belongs to www.unisonfi.com, and signs in there;
 *   B. a passkey made for the vercel.app alias before that (a "legacy" one) signs in on www.unisonfi.com through
 *      "Use a passkey made on unison-omega.vercel.app".
 *
 *   node scripts/flow-passkey-domains.mjs
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";

const MAIN = process.env.MAIN_ORIGIN ?? "https://www.unisonfi.com";
const ALIAS = process.env.ALIAS_ORIGIN ?? "https://unison-omega.vercel.app";
const RELAYER = process.env.TESTNET_RELAYER ?? "https://unison-relayer-production.up.railway.app";
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${String(e.message ?? e).split("\n")[0]}`);
  }
};
const b = await chromium.launch();

async function page(ctxOpts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, ...ctxOpts });
  await ctx.addInitScript(() => localStorage.setItem("unison.tour.v1", "done"));
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { ctx, p, cdp, authenticatorId };
}
const signInSheet = async (p, origin) => {
  await p.goto(`${origin}/trade/aNVDA?network=testnet`, { waitUntil: "domcontentloaded" });
  await p.getByText(/^Monad testnet$/).first().waitFor({ timeout: 30_000 });
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
};
const storedIdentity = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("unison.identity.testnet") ?? "null"));

// A: made on the alias, for www.unisonfi.com; signs in on www.unisonfi.com
await check("A. a passkey made on the vercel.app alias belongs to www.unisonfi.com", async () => {
  const { ctx, p } = await page();
  await signInSheet(p, ALIAS);
  await p.getByRole("button", { name: "Create a passkey" }).click();
  await p.getByText("Your account.").waitFor({ timeout: 60_000 });
  const made = await storedIdentity(p);
  if (made?.rpId !== new URL(MAIN).hostname) throw new Error(`made for ${made?.rpId}`);
  // the same authenticator, on the main domain, with nothing stored there yet
  await signInSheet(p, MAIN);
  await p.getByRole("button", { name: "I already have one" }).click();
  await p.getByText("Your account.").waitFor({ timeout: 60_000 });
  const back = await storedIdentity(p);
  if (back?.account !== made.account) throw new Error(`signed in as ${back?.account}, made ${made.account}`);
  await ctx.close();
});

// B: a passkey for the alias only (as every one made before the domain moved), used on www.unisonfi.com
await check("B. a legacy passkey (made for the vercel.app alias) signs in on www.unisonfi.com", async () => {
  const { ctx, p, cdp, authenticatorId } = await page();
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const hex = (b64u) => `0x${Buffer.from(b64u, "base64url").toString("hex")}`;
  const reg = await (await fetch(`${RELAYER}/v1/passkeys`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ qx: hex(jwk.x), qy: hex(jwk.y) }) })).json();
  if (!reg.account) throw new Error(`relayer: ${JSON.stringify(reg).slice(0, 120)}`);
  // the tape learns the registration from the chain
  for (let i = 0; i < 30 && !(await fetch(`https://unison-tape-production.up.railway.app/v1/passkeys/${reg.account}`)).ok; i++) await new Promise((r) => setTimeout(r, 2000));
  await cdp.send("WebAuthn.addCredential", {
    authenticatorId,
    credential: {
      credentialId: randomBytes(16).toString("base64"),
      isResidentCredential: true,
      rpId: new URL(ALIAS).hostname,
      privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      userHandle: randomBytes(16).toString("base64"),
      signCount: 0,
    },
  });
  await signInSheet(p, MAIN);
  await p.getByRole("button", { name: "I already have one" }).click();
  const older = p.getByRole("button", { name: `Use a passkey made on ${new URL(ALIAS).hostname}` });
  await older.waitFor({ timeout: 30_000 });
  await older.click();
  await p.getByText("Your account.").waitFor({ timeout: 60_000 });
  const id = await storedIdentity(p);
  if (id?.account?.toLowerCase() !== reg.account.toLowerCase()) throw new Error(`signed in as ${id?.account}, registered ${reg.account}`);
  if (id?.rpId !== new URL(ALIAS).hostname) throw new Error(`stored for ${id?.rpId}`);
  await ctx.close();
});

await b.close();
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
