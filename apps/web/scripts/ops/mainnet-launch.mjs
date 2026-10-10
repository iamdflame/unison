/**
 * Mainnet beta launch, from the repository root, with the deployer key (.secrets/mainnet.env, never printed):
 *
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs deploy        forge deploy of deploy/monad-mainnet-beta.json
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs seed <AUSD>   approve + requestDeposit into the aNVDA vault
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs sell <aNVDA>  deposit aNVDA and sell it into the vault's bid
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs sweep <to>   send what the deployer holds to <to>, keeping RESERVE_MON (10)
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs status
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs upgrade-causal   the causal cutover (SPEC §7.4)
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs challenge-deploy the standing challenge (both pots)
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs pot <unison|control> <AUSD>      fund a pot
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs seed-vault <wmon|control> <AUSD> requestDeposit
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs stock-wmon <wmon|control> <WMON> the vault's WMON
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs redeem-nvda <percent>            of the deployer's shares
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs team-sell-wmon <wmon|control> <WMON> a labelled team trade
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs bot-key                          the adversary's key
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs bot-fund <MON> <WMON> <AUSD>     fund it and its accounts
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs upgrade-phase-a                  exchange v3 (docs/ROADMAP.md, A)
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs timelock <proposer>              the final handover
 *
 * `deploy` refuses a chain other than 143 and refuses to overwrite deployments/monad-mainnet.json.
 * `upgrade-causal` runs contracts/script/UpgradeCausal.s.sol (which first checks that no job runs, no order waits and
 * no order rests), then folds its record into deployments/monad-mainnet.json. It refuses a deployment that is already
 * causal.
 * `upgrade-phase-a` runs contracts/script/UpgradePhaseA.s.sol: the exchange upgraded in place to v3 with GATEWAY_ROLE
 * locked in the same transaction, then verified on Sourcify and recorded. It refuses a deployment already at v3.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, http, isAddress, parseAbi, parseEther, parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { challengeAccountAbi, latencyChallengeAbi, monad } from "@unison/sdk";

const root = process.cwd();
const env = Object.fromEntries(
  readFileSync(join(root, ".secrets/mainnet.env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.trim().split("=")),
);
const RPC = process.env.RPC_URL ?? "https://rpc-mainnet.monadinfra.com";
// DEPLOYMENT_RECORD=deployments/<name>.json rehearses on a fork (with RPC_URL and FORGE_RPC pointing at it): every
// record the scripts write is then named after it, and deployments/monad-mainnet.json is never touched
const RECORD = process.env.DEPLOYMENT_RECORD ?? "deployments/monad-mainnet.json";
const BASE = RECORD.replace(/^deployments\//, "").replace(/\.json$/, "");
const OUT = join(root, RECORD);
const deployer = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const pub = createPublicClient({ chain: monad, transport: http(RPC) });
const wallet = createWalletClient({ chain: monad, transport: http(RPC), account: deployer });
const venueAbi = parseAbi([
  "function deposit(address token, uint256 amount)",
  "function depositFor(address account, address token, uint256 amount)",
  "function placeOrder(uint256 marketId, uint256 side, uint256 tick, uint256 qty, uint256 flags) returns (uint256)",
  "function balanceOf(address account, address token) view returns (uint256)",
  "function withdraw(address token, uint256 amount, address to)",
]);
const vaultAbi = parseAbi([
  "function requestDeposit(uint256 assets)",
  "function requestRedeem(uint256 shares)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function nav() view returns (uint256)",
]);
const wmonAbi = parseAbi(["function deposit() payable"]);
const refAbi = parseAbi(["function read(uint256 marketId, uint256 batch, bytes payload) view returns (uint256 price, uint256 publishTimeMs, uint8 status)"]);

const send = async (what, req) => {
  // Monad charges the gas limit: estimate on Monad, then a margin
  const gas = ((await pub.estimateContractGas({ account: deployer, ...req })) * 125n) / 100n;
  const hash = await wallet.writeContract({ ...req, gas });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`${what}: ${r.status} ${hash}`);
  if (r.status !== "success") throw new Error(`${what} reverted`);
};
const dep = () => JSON.parse(readFileSync(OUT, "utf8"));
const nvda = () => dep().markets["aNVDA/AUSD"];

const [cmd, arg, arg2, arg3] = process.argv.slice(2);
/** A forge script from contracts/, on the public endpoint, with the deployer's key; prints the lines that matter. */
const forgeScript = (script, extraEnv, pattern) => {
  const forge = process.env.FORGE ?? join(homedir(), ".foundry/bin/forge");
  const r = spawnSync(forge, ["script", script, "--rpc-url", process.env.FORGE_RPC ?? "https://rpc.monad.xyz", "--broadcast", "--slow"], {
    cwd: join(root, "contracts"),
    env: { ...process.env, DEPLOYER_PRIVATE_KEY: env.DEPLOYER_PRIVATE_KEY, DEPLOYMENT: `../${RECORD}`, ...extraEnv },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  console.log(`${r.stdout}\n${r.stderr}`.split("\n").filter((l) => pattern.test(l) || /ONCHAIN|Error|error|revert|Paid/.test(l)).join("\n"));
  if (r.status !== 0) process.exit(r.status ?? 1);
};
/** The market a subcommand names: "wmon" (Unison's causal WMON/AUSD) or "control" (the old-rule market). */
const wmonMarket = (which) => {
  const d = dep();
  const m = Object.values(d.markets).find((x) => (which === "control" ? x.control : x.symbol === "WMON/AUSD"));
  if (!m) throw new Error(`no ${which} market in the deployment`);
  return { d, m, adapter: which === "control" ? d.chainlinkReference : d.causalReference };
};
if (cmd === "deploy") {
  if ((await pub.getChainId()) !== 143) throw new Error("not Monad mainnet");
  if (existsSync(OUT)) throw new Error(`${OUT} exists: already deployed`);
  const bal = await pub.getBalance({ address: deployer.address });
  if (bal < 10n * 10n ** 18n) throw new Error(`deployer holds ${formatEther(bal)} MON; keep at least 10 for the deploy`);
  const forge = process.env.FORGE ?? join(homedir(), ".foundry/bin/forge");
  const r = spawnSync(forge, ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast", "--slow"], {
    cwd: join(root, "contracts"),
    env: { ...process.env, DEPLOYER_PRIVATE_KEY: env.DEPLOYER_PRIVATE_KEY, DEPLOY_CONFIG: "../deploy/monad-mainnet-beta.json", DEPLOY_OUT: "monad-mainnet" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = `${r.stdout}\n${r.stderr}`.split("\n").filter((l) => /UnisonExchange|written|ONCHAIN|Error|error|Estimated|Transactions saved|Paid/.test(l));
  console.log(lines.join("\n"));
  if (r.status !== 0) process.exit(r.status ?? 1);
} else if (cmd === "upgrade-causal") {
  if ((await pub.getChainId()) !== 143) throw new Error("not Monad mainnet");
  if (dep().causalReference) throw new Error(`${RECORD} already names a causalReference`);
  const forge = process.env.FORGE ?? join(homedir(), ".foundry/bin/forge");
  // forge broadcasts on the public endpoint: the load-balanced one has answered "block not found" mid-script
  const r = spawnSync(forge, ["script", "script/UpgradeCausal.s.sol", "--rpc-url", process.env.FORGE_RPC ?? "https://rpc.monad.xyz", "--broadcast", "--slow"], {
    cwd: join(root, "contracts"),
    env: {
      ...process.env,
      DEPLOYER_PRIVATE_KEY: env.DEPLOYER_PRIVATE_KEY,
      DEPLOYMENT: `../${RECORD}`,
      CAUSAL_CONFIG: "../deploy/monad-mainnet-causal.json",
      CAUSAL_OUT: `${BASE}-causal`,
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = `${r.stdout}\n${r.stderr}`.split("\n").filter((l) => /implementation|causal reference|control market|written|ONCHAIN|Error|error|revert|Estimated|Transactions saved|Paid/.test(l));
  console.log(lines.join("\n"));
  if (r.status !== 0) process.exit(r.status ?? 1);
  const m = spawnSync(process.execPath, ["scripts/merge-causal.mjs", RECORD, `deployments/${BASE}-causal.json`, "deploy/monad-mainnet-causal.json"], {
    cwd: root,
    stdio: "inherit",
  });
  if (m.status !== 0) process.exit(m.status ?? 1);
} else if (cmd === "challenge-deploy") {
  if (!dep().causalReference) throw new Error("run upgrade-causal first");
  if (dep().challenge) throw new Error("the deployment already names a challenge");
  forgeScript("script/DeployChallenge.s.sol", { CHALLENGE_CONFIG: "../deploy/monad-mainnet-challenge.json", CHALLENGE_OUT: `${BASE}-challenge` }, /challenge on|written/);
  const m = spawnSync(process.execPath, ["scripts/merge-challenge.mjs", RECORD, `deployments/${BASE}-challenge.json`], { cwd: root, stdio: "inherit" });
  if (m.status !== 0) process.exit(m.status ?? 1);
} else if (cmd === "pot") {
  const d = dep();
  const to = d.challenge?.[arg];
  if (!to || !arg2) throw new Error("usage: pot <unison|control> <AUSD>");
  const amount = parseUnits(arg2, 6);
  await send(`fund the ${arg} pot with ${arg2} AUSD`, { address: d.tokens.AUSD.address, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
} else if (cmd === "seed-vault") {
  const { m } = wmonMarket(arg);
  if (!arg2) throw new Error("usage: seed-vault <wmon|control> <AUSD>");
  const amount = parseUnits(arg2, 6);
  await send(`approve ${arg2} AUSD to the ${arg} vault`, { address: m.quote, abi: erc20Abi, functionName: "approve", args: [m.vault, amount] });
  await send(`requestDeposit ${arg2} AUSD`, { address: m.vault, abi: vaultAbi, functionName: "requestDeposit", args: [amount] });
  console.log("the keeper settles it at the first reference observed after this request");
} else if (cmd === "stock-wmon") {
  // the vault starts with AUSD only; its LP (the deployer, holding every share) adds WMON so it quotes both sides.
  // Only once its first deposit has settled, so the shares were priced on AUSD alone.
  const { d, m } = wmonMarket(arg);
  if (!arg2) throw new Error("usage: stock-wmon <wmon|control> <WMON>");
  const supply = await pub.readContract({ address: m.vault, abi: vaultAbi, functionName: "totalSupply" });
  if (supply === 0n) throw new Error("the vault's first deposit hasn't settled yet: wait for the keeper to process it");
  const qty = parseUnits(arg2, 18);
  const hash = await wallet.writeContract({ address: m.base, abi: wmonAbi, functionName: "deposit", value: qty, gas: 80_000n });
  console.log(`wrap ${arg2} MON: ${(await pub.waitForTransactionReceipt({ hash })).status} ${hash}`);
  await send("approve WMON to the venue", { address: m.base, abi: erc20Abi, functionName: "approve", args: [d.exchange, qty] });
  await send(`add ${arg2} WMON to the ${arg} vault's inventory`, { address: d.exchange, abi: venueAbi, functionName: "depositFor", args: [m.vault, m.base, qty] });
} else if (cmd === "redeem-nvda") {
  const m = nvda();
  const pct = BigInt(arg ?? "0");
  if (pct <= 0n || pct > 100n) throw new Error("usage: redeem-nvda <percent of the deployer's shares>");
  const shares = ((await pub.readContract({ address: m.vault, abi: vaultAbi, functionName: "balanceOf", args: [deployer.address] })) * pct) / 100n;
  await send(`requestRedeem ${pct}% of the deployer's aNVDA vault shares`, { address: m.vault, abi: vaultAbi, functionName: "requestRedeem", args: [shares] });
} else if (cmd === "bot-key") {
  // the adversary's own key, generated here and kept in .secrets/mainnet.env: only its address is printed
  if (!env.ADVERSARY_PRIVATE_KEY) {
    const pk = generatePrivateKey();
    appendFileSync(join(root, ".secrets/mainnet.env"), `\nADVERSARY_PRIVATE_KEY=${pk}\n`);
    console.log(`new adversary key: ${privateKeyToAccount(pk).address}`);
  } else console.log(`adversary: ${privateKeyToAccount(env.ADVERSARY_PRIVATE_KEY).address}`);
} else if (cmd === "bot-fund") {
  // MON for its gas, then WMON and AUSD split across its two challenge accounts (opened here if it has none)
  if (!env.ADVERSARY_PRIVATE_KEY) throw new Error("run bot-key first");
  const d = dep();
  if (!d.challenge) throw new Error("run challenge-deploy first");
  const [mon, wmon, ausd] = [parseEther(arg ?? "0"), parseUnits(arg2 ?? "0", 18), parseUnits(arg3 ?? "0", 6)];
  const bot = privateKeyToAccount(env.ADVERSARY_PRIVATE_KEY);
  const botWallet = createWalletClient({ chain: monad, transport: http(RPC), account: bot });
  const as = async (what, req) => {
    const gas = ((await pub.estimateContractGas({ account: bot, ...req })) * 125n) / 100n;
    const hash = await botWallet.writeContract({ ...req, gas });
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`${what}: ${r.status} ${hash}`);
    if (r.status !== "success") throw new Error(`${what} reverted`);
  };
  const WMON = d.markets["WMON/AUSD"].base;
  const AUSD = d.tokens.AUSD.address;
  if (mon + wmon > 0n) {
    const hash = await wallet.sendTransaction({ to: bot.address, value: mon + wmon, gas: 21_000n });
    console.log(`send ${formatEther(mon + wmon)} MON to the adversary: ${(await pub.waitForTransactionReceipt({ hash })).status} ${hash}`);
  }
  if (ausd > 0n) await send(`send ${arg3} AUSD to the adversary`, { address: AUSD, abi: erc20Abi, functionName: "transfer", args: [bot.address, ausd] });
  if (wmon > 0n) {
    const hash = await botWallet.writeContract({ address: WMON, abi: wmonAbi, functionName: "deposit", value: wmon, gas: 80_000n });
    console.log(`wrap ${arg2} MON: ${(await pub.waitForTransactionReceipt({ hash })).status} ${hash}`);
  }
  const accounts = [];
  for (const name of ["unison", "control"]) {
    const challenge = d.challenge[name];
    let acct = await pub.readContract({ address: challenge, abi: latencyChallengeAbi, functionName: "accountOf", args: [bot.address] });
    if (/^0x0+$/.test(acct)) {
      await as(`open the adversary's ${name} account`, { address: challenge, abi: latencyChallengeAbi, functionName: "open" });
      acct = await pub.readContract({ address: challenge, abi: latencyChallengeAbi, functionName: "accountOf", args: [bot.address] });
    }
    for (const [token, amount, label] of [[WMON, wmon / 2n, "WMON"], [AUSD, ausd / 2n, "AUSD"]]) {
      if (amount === 0n) continue;
      await as(`approve ${label} to the ${name} account`, { address: token, abi: erc20Abi, functionName: "approve", args: [acct, amount] });
      await as(`deposit ${label} into the ${name} account`, { address: acct, abi: challengeAccountAbi, functionName: "deposit", args: [token, amount] });
    }
    accounts.push(acct);
  }
  // the record names the adversary and its challenge accounts, so the tape counts their fills as the team's
  const rec = dep();
  rec.adversary = { address: bot.address, accounts };
  writeFileSync(OUT, JSON.stringify(rec, null, 2));
  console.log(`${RECORD}: adversary ${bot.address}, accounts ${accounts.join(", ")}`);
} else if (cmd === "upgrade-phase-a") {
  if ((await pub.getChainId()) !== 143) throw new Error("not Monad mainnet");
  if (dep().exchangeVersion >= 3) throw new Error(`${RECORD} is already at exchange v3`);
  forgeScript("script/UpgradePhaseA.s.sol", { PHASE_A_OUT: `${BASE}-phase-a` }, /implementation|written/);
  const p = JSON.parse(readFileSync(join(root, `deployments/${BASE}-phase-a.json`), "utf8"));
  // the new implementation's source, public before anyone has to trust it
  const forge = process.env.FORGE ?? join(homedir(), ".foundry/bin/forge");
  const v = spawnSync(forge, ["verify-contract", p.exchangeImplementation, "src/core/UnisonExchange.sol:UnisonExchange", "--chain", "143", "--verifier", "sourcify"], {
    cwd: join(root, "contracts"),
    encoding: "utf8",
  });
  console.log(`${v.stdout}\n${v.stderr}`.split("\n").filter((l) => /verified|Verified|match|error|Error/.test(l)).join("\n"));
  const d = dep();
  Object.assign(d, { exchangeImplementation: p.exchangeImplementation, exchangeVersion: 3 });
  const sorted = (x) => (Array.isArray(x) ? x.map(sorted) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted(x[k])])) : x);
  writeFileSync(OUT, JSON.stringify(sorted(d), null, 2));
  console.log(`${RECORD}: exchange v3, implementation ${p.exchangeImplementation}`);
} else if (cmd === "timelock") {
  if (!arg || !isAddress(arg)) throw new Error("usage: timelock <proposer: the owner's wallet>");
  if (dep().timelock) throw new Error("the deployment already names a timelock");
  forgeScript("script/HandoverTimelock.s.sol", { TIMELOCK_PROPOSER: arg, TIMELOCK_OUT: `${BASE}-timelock` }, /timelock|operation|executable|written/);
  const t = JSON.parse(readFileSync(join(root, `deployments/${BASE}-timelock.json`), "utf8"));
  const d = dep();
  Object.assign(d, { admin: t.timelock, timelock: t.timelock, timelockProposer: t.proposer, timelockDelaySec: t.delaySec, timelockFinalDelaySec: t.finalDelaySec, timelockOperation: t.operation, timelockExecutableAfter: t.executableAfter });
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  writeFileSync(OUT, JSON.stringify(sorted(d), null, 2));
  console.log(`${RECORD}: admin is now the timelock ${t.timelock}`);
} else if (cmd === "seed") {
  const m = nvda();
  const amount = parseUnits(arg, 6);
  await send(`approve ${arg} AUSD to the vault`, { address: m.quote, abi: erc20Abi, functionName: "approve", args: [m.vault, amount] });
  await send(`requestDeposit ${arg} AUSD`, { address: m.vault, abi: vaultAbi, functionName: "requestDeposit", args: [amount] });
} else if (cmd === "sell") {
  const d = dep();
  const m = nvda();
  const qty = arg === "all" ? await pub.readContract({ address: m.base, abi: erc20Abi, functionName: "balanceOf", args: [deployer.address] }) : parseUnits(arg, 18);
  const [price, , status] = await pub.readContract({ address: d.chainlinkReference, abi: refAbi, functionName: "read", args: [BigInt(m.id), 0n, "0x"] });
  // a limit 1% under the reference: inside the band, through the vault's bid, so it fills at the auction's price
  const tick = (price * 99n) / 100n / 10_000n;
  console.log(`reference $${formatUnits(price, 6)} (status ${status}); selling ${formatUnits(qty, 18)} aNVDA at ≥ $${formatUnits(tick * 10_000n, 6)}`);
  await send("approve aNVDA to the venue", { address: m.base, abi: erc20Abi, functionName: "approve", args: [d.exchange, qty] });
  await send("deposit aNVDA", { address: d.exchange, abi: venueAbi, functionName: "deposit", args: [m.base, qty] });
  await send("sell aNVDA into the vault's bid", { address: d.exchange, abi: venueAbi, functionName: "placeOrder", args: [BigInt(m.id), 1n, tick, qty, 0n] });
} else if (cmd === "team-sell-wmon") {
  // A labelled team trade (the deployer is in the tape's TEAM_ACCOUNTS): a little WMON sold through the vault's bid, so
  // the market prints and its receipt can be checked. The limit sits 1% under the reference; the auction sets the price.
  const { d, m, adapter } = wmonMarket(arg);
  if (!arg2) throw new Error("usage: team-sell-wmon <wmon|control> <WMON>");
  const qty = parseUnits(arg2, 18);
  const [price, , status] = await pub.readContract({ address: adapter, abi: refAbi, functionName: "read", args: [BigInt(m.id), 0n, "0x"] });
  const tick = (price * 99n) / 100n; // WMON's tick is a millionth of an AUSD, the reference's own unit
  console.log(`reference $${formatUnits(price, 6)} (status ${status}); selling ${arg2} WMON at ≥ $${formatUnits(tick, 6)}, one auction`);
  const hash = await wallet.writeContract({ address: m.base, abi: wmonAbi, functionName: "deposit", value: qty, gas: 80_000n });
  console.log(`wrap ${arg2} MON: ${(await pub.waitForTransactionReceipt({ hash })).status} ${hash}`);
  await send("approve WMON to the venue", { address: m.base, abi: erc20Abi, functionName: "approve", args: [d.exchange, qty] });
  await send("deposit WMON", { address: d.exchange, abi: venueAbi, functionName: "deposit", args: [m.base, qty] });
  await send(`sell ${arg2} WMON into the ${arg} vault's bid`, { address: d.exchange, abi: venueAbi, functionName: "placeOrder", args: [BigInt(m.id), 1n, tick, qty, 1n] });
} else if (cmd === "sweep") {
  // everything the deployer holds goes to `to`, except a MON reserve for the admin's own transactions
  const to = arg;
  if (!to || !isAddress(to)) throw new Error("usage: sweep <0x address>");
  const reserve = parseEther(process.env.RESERVE_MON ?? "10");
  const d = dep();
  const ausd = d.tokens.AUSD.address;
  const onVenue = await pub.readContract({ address: d.exchange, abi: venueAbi, functionName: "balanceOf", args: [deployer.address, ausd] });
  if (onVenue > 0n) await send(`withdraw ${formatUnits(onVenue, 6)} AUSD from the venue to ${to}`, { address: d.exchange, abi: venueAbi, functionName: "withdraw", args: [ausd, onVenue, to] });
  const inWallet = await pub.readContract({ address: ausd, abi: erc20Abi, functionName: "balanceOf", args: [deployer.address] });
  if (inWallet > 0n) await send(`transfer ${formatUnits(inWallet, 6)} AUSD to ${to}`, { address: ausd, abi: erc20Abi, functionName: "transfer", args: [to, inWallet] });
  const bal = await pub.getBalance({ address: deployer.address });
  const gasPrice = await pub.getGasPrice();
  const fee = 21_000n * gasPrice * 2n;
  const value = bal - reserve - fee;
  if (value > 0n) {
    const hash = await wallet.sendTransaction({ to, value, gas: 21_000n, gasPrice: gasPrice * 2n });
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`send ${formatEther(value)} MON to ${to}: ${r.status} ${hash}`);
  }
  console.log(`deployer keeps ${formatEther(await pub.getBalance({ address: deployer.address }))} MON for admin transactions`);
} else if (cmd === "status") {
  const [mon] = await Promise.all([pub.getBalance({ address: deployer.address })]);
  console.log(`deployer ${deployer.address}: ${formatEther(mon)} MON`);
  if (existsSync(OUT)) {
    const d = dep();
    const m = nvda();
    const [supply, nav, venueAusd, venueNvda, vAusd, vNvda] = await Promise.all([
      pub.readContract({ address: m.vault, abi: vaultAbi, functionName: "totalSupply" }),
      pub.readContract({ address: m.vault, abi: vaultAbi, functionName: "nav" }).catch(() => 0n),
      pub.readContract({ address: d.exchange, abi: venueAbi, functionName: "balanceOf", args: [deployer.address, m.quote] }),
      pub.readContract({ address: d.exchange, abi: venueAbi, functionName: "balanceOf", args: [deployer.address, m.base] }),
      pub.readContract({ address: d.exchange, abi: venueAbi, functionName: "balanceOf", args: [m.vault, m.quote] }),
      pub.readContract({ address: d.exchange, abi: venueAbi, functionName: "balanceOf", args: [m.vault, m.base] }),
    ]);
    console.log(`exchange ${d.exchange}`);
    console.log(`aNVDA vault ${m.vault}: shares ${supply}, NAV ${formatUnits(nav, 6)} AUSD, holds ${formatUnits(vAusd, 6)} AUSD + ${formatUnits(vNvda, 18)} aNVDA`);
    console.log(`deployer on the venue: ${formatUnits(venueAusd, 6)} AUSD + ${formatUnits(venueNvda, 18)} aNVDA`);
  }
} else {
  console.log("usage: deploy | seed <AUSD> | sell <aNVDA|all> | status");
}
