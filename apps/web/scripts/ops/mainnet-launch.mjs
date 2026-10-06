/**
 * Mainnet beta launch, from the repository root, with the deployer key (.secrets/mainnet.env, never printed):
 *
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs deploy        forge deploy of deploy/monad-mainnet-beta.json
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs seed <AUSD>   approve + requestDeposit into the aNVDA vault
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs sell <aNVDA>  deposit aNVDA and sell it into the vault's bid
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs sweep <to>   send what the deployer holds to <to>, keeping RESERVE_MON (10)
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs status
 *   node --conditions=development apps/web/scripts/ops/mainnet-launch.mjs upgrade-causal   the causal cutover (SPEC §7.4)
 *
 * `deploy` refuses a chain other than 143 and refuses to overwrite deployments/monad-mainnet.json.
 * `upgrade-causal` runs contracts/script/UpgradeCausal.s.sol (which first checks that no job runs, no order waits and
 * no order rests), then folds its record into deployments/monad-mainnet.json. It refuses a deployment that is already
 * causal.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, http, isAddress, parseAbi, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "@unison/sdk";

const root = process.cwd();
const env = Object.fromEntries(
  readFileSync(join(root, ".secrets/mainnet.env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.trim().split("=")),
);
const RPC = process.env.RPC_URL ?? "https://rpc-mainnet.monadinfra.com";
const OUT = join(root, "deployments/monad-mainnet.json");
const deployer = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const pub = createPublicClient({ chain: monad, transport: http(RPC) });
const wallet = createWalletClient({ chain: monad, transport: http(RPC), account: deployer });
const venueAbi = parseAbi([
  "function deposit(address token, uint256 amount)",
  "function placeOrder(uint256 marketId, uint256 side, uint256 tick, uint256 qty, uint256 flags) returns (uint256)",
  "function balanceOf(address account, address token) view returns (uint256)",
  "function withdraw(address token, uint256 amount, address to)",
]);
const vaultAbi = parseAbi(["function requestDeposit(uint256 assets)", "function totalSupply() view returns (uint256)", "function nav() view returns (uint256)"]);
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

const [cmd, arg] = process.argv.slice(2);
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
  if (dep().causalReference) throw new Error("deployments/monad-mainnet.json already names a causalReference");
  const forge = process.env.FORGE ?? join(homedir(), ".foundry/bin/forge");
  // forge broadcasts on the public endpoint: the load-balanced one has answered "block not found" mid-script
  const r = spawnSync(forge, ["script", "script/UpgradeCausal.s.sol", "--rpc-url", process.env.FORGE_RPC ?? "https://rpc.monad.xyz", "--broadcast", "--slow"], {
    cwd: join(root, "contracts"),
    env: {
      ...process.env,
      DEPLOYER_PRIVATE_KEY: env.DEPLOYER_PRIVATE_KEY,
      DEPLOYMENT: "../deployments/monad-mainnet.json",
      CAUSAL_CONFIG: "../deploy/monad-mainnet-causal.json",
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = `${r.stdout}\n${r.stderr}`.split("\n").filter((l) => /implementation|causal reference|control market|written|ONCHAIN|Error|error|revert|Estimated|Transactions saved|Paid/.test(l));
  console.log(lines.join("\n"));
  if (r.status !== 0) process.exit(r.status ?? 1);
  const m = spawnSync(process.execPath, ["scripts/merge-causal.mjs", "deployments/monad-mainnet.json", "deployments/monad-mainnet-causal.json", "deploy/monad-mainnet-causal.json"], {
    cwd: root,
    stdio: "inherit",
  });
  if (m.status !== 0) process.exit(m.status ?? 1);
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
