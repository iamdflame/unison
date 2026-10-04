#!/usr/bin/env node
/**
 * The full local stack in one command, for the web app and the e2e tests:
 *
 *   anvil (chain 31337, :8545) → contracts/script/DevNet.s.sol → relay (:8787, sim prices) → keeper (auto-claim)
 *   → relayer (:8788, faucet on) → tape (:8790)
 *
 * Prints every URL, writes an env snippet for apps/web, and stops every child process on exit and on Ctrl-C.
 *
 *   node scripts/dev-stack.mjs                 everything
 *   node scripts/dev-stack.mjs --chain-only    anvil + deploy only (then: pnpm --filter @unison/keeper e2e)
 *   node scripts/dev-stack.mjs --verbose       also echo service logs (always in .dev-stack/<name>.log)
 *
 * Env overrides: ANVIL_PORT (8545), RELAY_PORT (8787), RELAYER_PORT (8788), TAPE_PORT (8790), BLOCK_TIME (1),
 *   PROVIDER (sim), SESSION (always), SESSION_OVERRIDE, CLEAR_GAS, CORS_ORIGINS (http://localhost:3000),
 *   FORGE_OUT / FORGE_CACHE (forge --out / --cache-path, to keep this build apart from contracts/out),
 *   WEB_ENV_OUT (.dev-stack/web.env.local; e.g. apps/web/.env.local), STACK_DIR (.dev-stack)
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const chainOnly = args.has("--chain-only");
const verbose = args.has("--verbose") || args.has("-v");
const env = (k, d) => process.env[k] ?? d;

const ports = {
  anvil: Number(env("ANVIL_PORT", "8545")),
  relay: Number(env("RELAY_PORT", "8787")),
  relayer: Number(env("RELAYER_PORT", "8788")),
  tape: Number(env("TAPE_PORT", "8790")),
};
const stackDir = resolve(root, env("STACK_DIR", ".dev-stack"));
const rpc = `http://127.0.0.1:${ports.anvil}`;
const deployment = join(root, "deployments", "31337.json");

// anvil's well-known dev keys (local chains only): #1 relay signer, #2 keeper, #6 relayer
const KEYS = {
  relay: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  keeper: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  relayer: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
};

const children = [];
let stopping = false;

function log(msg) {
  console.log(`[dev-stack] ${msg}`);
}

function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of [...children].reverse()) kill(c.proc);
  process.exit(code);
}

process.on("SIGINT", () => {
  log("stopping…");
  shutdown(130);
});
process.on("SIGTERM", () => shutdown(143));
process.on("exit", () => {
  for (const c of children) kill(c.proc);
});
process.on("uncaughtException", (e) => {
  console.error(e);
  shutdown(1);
});

/** Spawns a long-running child; its output goes to .dev-stack/<name>.log (and the console with --verbose). */
function start(name, cmd, cmdArgs, opts = {}) {
  const out = createWriteStream(join(stackDir, `${name}.log`));
  const proc = spawn(cmd, cmdArgs, { cwd: opts.cwd ?? root, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"] });
  const pipe = (stream) =>
    stream.on("data", (chunk) => {
      out.write(chunk);
      if (verbose) for (const line of String(chunk).split(/\r?\n/)) if (line) console.log(`[${name}] ${line}`);
    });
  pipe(proc.stdout);
  pipe(proc.stderr);
  proc.on("exit", (code, signal) => {
    if (stopping || opts.oneShot) return;
    console.error(`[dev-stack] ${name} exited (${signal ?? code}); see ${join(stackDir, `${name}.log`)}`);
    shutdown(1);
  });
  proc.on("error", (e) => {
    console.error(`[dev-stack] could not start ${name} (${cmd}): ${e.message}`);
    shutdown(1);
  });
  children.push({ name, proc });
  return proc;
}

function portFree(port) {
  return new Promise((ok) => {
    const s = createServer()
      .once("error", () => ok(false))
      .once("listening", () => s.close(() => ok(true)))
      .listen(port, "127.0.0.1");
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, ms, probe) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if (await probe()) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function rpcCall(method, params = []) {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

async function main() {
  mkdirSync(stackDir, { recursive: true });
  const needed = chainOnly ? { anvil: ports.anvil } : ports;
  for (const [name, port] of Object.entries(needed)) {
    if (!(await portFree(port))) throw new Error(`port ${port} (${name}) is already in use; stop whatever runs there first`);
  }
  // a fresh chain needs fresh service databases
  for (const f of ["tape.db", "tape.db-wal", "tape.db-shm", "relayer.db", "relayer.db-wal", "relayer.db-shm"]) {
    rmSync(join(stackDir, f), { force: true });
  }

  const blockTime = env("BLOCK_TIME", "1");
  log(`anvil on ${rpc} (block time ${blockTime === "0" ? "automine" : `${blockTime}s`})`);
  start("anvil", "anvil", [
    "--code-size-limit",
    "131072",
    "--chain-id",
    "31337",
    "--port",
    String(ports.anvil),
    ...(blockTime === "0" ? [] : ["--block-time", blockTime]),
  ]);
  await waitFor("anvil", 30_000, async () => (await rpcCall("eth_chainId")) === "0x7a69");
  // createMarket starts batches at block.number - 1: never deploy at genesis
  await rpcCall("anvil_mine", ["0x2"]);

  log("deploying contracts/script/DevNet.s.sol …");
  const forgeArgs = ["script", "script/DevNet.s.sol", "--rpc-url", rpc, "--broadcast"];
  if (process.env.FORGE_OUT) forgeArgs.push("--out", resolve(process.env.FORGE_OUT));
  if (process.env.FORGE_CACHE) forgeArgs.push("--cache-path", resolve(process.env.FORGE_CACHE));
  const forge = start("forge", "forge", forgeArgs, { cwd: join(root, "contracts"), oneShot: true });
  const code = await new Promise((r) => forge.on("exit", r));
  if (code !== 0) throw new Error(`DevNet deploy failed (exit ${code}); see ${join(stackDir, "forge.log")}`);
  if (!existsSync(deployment)) throw new Error(`deploy wrote no ${deployment}`);
  log(`deployed → ${deployment}`);

  if (chainOnly) {
    log(`chain ready: ${rpc} (chain 31337). Ctrl-C to stop.`);
    return;
  }

  const common = { RPC_URL: rpc, DEPLOYMENT: deployment, CORS_ORIGINS: env("CORS_ORIGINS", "http://localhost:3000") };
  const node = (svc, extra) =>
    start(svc, process.execPath, ["--conditions=development", "src/main.ts"], {
      cwd: join(root, "services", svc),
      env: { ...common, ...extra },
    });

  node("relay", {
    PORT: String(ports.relay),
    RELAY_PRIVATE_KEY: KEYS.relay,
    PROVIDER: env("PROVIDER", "sim"),
    SESSION: env("SESSION", "always"),
  });
  await waitFor("relay", 60_000, async () => (await fetch(`http://127.0.0.1:${ports.relay}/health`)).ok);
  node("keeper", {
    KEEPER_PRIVATE_KEY: KEYS.keeper,
    RELAY_URL: `http://127.0.0.1:${ports.relay}`,
    AUTO_CLAIM: "1",
    // Size each clear from its estimate: a busy book under Ethereum gas rules outgrows a fixed 8M, and one
    // failed clear only grows the next one. Anvil's estimator sizes full jobs (docs/DEPLOY.md).
    CLEAR_GAS: env("CLEAR_GAS", "auto"),
  });
  node("relayer", {
    PORT: String(ports.relayer),
    RELAYER_PRIVATE_KEY: KEYS.relayer,
    FAUCET: "1",
    // every browser test on this machine shares one IP; the public testnet keeps the default of 3 a day
    FAUCET_PER_IP: "1000",
    JOBS_DB: join(stackDir, "relayer.db"),
  });
  node("tape", {
    PORT: String(ports.tape),
    DB_PATH: join(stackDir, "tape.db"),
    RELAY_URL: `http://127.0.0.1:${ports.relay}`,
    RPC_WS_URL: `ws://127.0.0.1:${ports.anvil}`,
  });
  await waitFor("relayer", 60_000, async () => (await fetch(`http://127.0.0.1:${ports.relayer}/health`)).ok);
  await waitFor("tape", 60_000, async () => (await fetch(`http://127.0.0.1:${ports.tape}/health`)).ok);

  const urls = {
    NEXT_PUBLIC_CHAIN_ID: "31337",
    NEXT_PUBLIC_RPC_URL: rpc,
    NEXT_PUBLIC_TAPE_URL: `http://127.0.0.1:${ports.tape}`,
    NEXT_PUBLIC_RELAYER_URL: `http://127.0.0.1:${ports.relayer}`,
    NEXT_PUBLIC_RELAY_URL: `http://127.0.0.1:${ports.relay}`,
    NEXT_PUBLIC_FAUCET: "1",
  };
  const snippet = `# written by scripts/dev-stack.mjs: local devnet services\n${Object.entries(urls)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;
  const out = resolve(root, env("WEB_ENV_OUT", join(stackDir, "web.env.local")));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, snippet);

  console.log(`
  Unison devnet is up (Ctrl-C stops everything)

    chain    ${rpc}  (31337, ws://127.0.0.1:${ports.anvil})
    relay    http://127.0.0.1:${ports.relay}/prices
    relayer  http://127.0.0.1:${ports.relayer}/health   (faucet on)
    tape     http://127.0.0.1:${ports.tape}/v1/markets
    keeper   clearing every market, auto-claiming
    logs     ${stackDir}

  apps/web env (${out}):
${snippet
  .trim()
  .split("\n")
  .map((l) => `    ${l}`)
  .join("\n")}
`);
}

main().catch((e) => {
  console.error(`[dev-stack] ${e.message}`);
  shutdown(1);
});
