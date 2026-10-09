/**
 * Every role ever granted or revoked on a deployment's AccessControl contracts (the exchange, its vaults, the operator
 * reference), and every ownership change on its Ownable ones (the adapters, the eligibility mirror), read from the
 * chain alone: who holds what now. AccessControl doesn't enumerate its members, so the logs are the record.
 * Read-only. The public endpoint answers eth_getLogs over 100 blocks at most, so it walks in parallel windows.
 *
 *   node --conditions=development packages/sdk/scripts/scan-roles.mjs [deployments/monad-mainnet.json] > roles.json
 */
import { readFileSync } from "node:fs";
import { createPublicClient, http, keccak256, parseAbiItem, toHex } from "viem";

const dep = JSON.parse(readFileSync(process.argv[2] ?? new URL("../../../deployments/monad-mainnet.json", import.meta.url), "utf8"));
const client = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://rpc.monad.xyz", { retryCount: 5, retryDelay: 400, timeout: 30_000 }) });
const STEP = 100n;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 12);

const granted = parseAbiItem("event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)");
const revoked = parseAbiItem("event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)");
const adminChanged = parseAbiItem("event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole)");
const ownership = parseAbiItem("event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)");
const started = parseAbiItem("event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)");

const accessControl = [dep.exchange, dep.operatorReference, ...Object.values(dep.markets).flatMap((m) => (m.vault ? [m.vault] : []))].filter(Boolean);
const ownable = [dep.causalReference, dep.chainlinkReference, dep.eligibility].filter(Boolean);
const names = new Map(
  ["DEFAULT_ADMIN_ROLE", "OPERATOR_ROLE", "GUARDIAN_ROLE", "HALT_ROLE", "GATEWAY_ROLE", "CAP_ROLE", "RISK_ROLE", "SIGNER_ADMIN_ROLE", "SLASHER_ROLE"].map((n) => [
    n === "DEFAULT_ADMIN_ROLE" ? toHex(0n, { size: 32 }) : keccak256(toHex(n)),
    n,
  ]),
);

const from = BigInt(dep.startBlock ?? 0);
const to = await client.getBlockNumber();
const windows = [];
for (let a = from; a <= to; a += STEP) windows.push([a, a + STEP - 1n > to ? to : a + STEP - 1n]);
const logs = [];
let done = 0;
async function worker(queue) {
  for (let w = queue.pop(); w; w = queue.pop()) {
    const [a, b] = w;
    const [ac, ow] = await Promise.all([
      client.getLogs({ address: accessControl, events: [granted, revoked, adminChanged], fromBlock: a, toBlock: b }),
      client.getLogs({ address: ownable, events: [ownership, started], fromBlock: a, toBlock: b }),
    ]);
    logs.push(...ac, ...ow);
    if (++done % 500 === 0) process.stderr.write(`${done}/${windows.length} windows\n`);
  }
}
const queue = [...windows].reverse();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
logs.sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : Number(x.blockNumber - y.blockNumber)));

const holders = {}; // contract → role → Set(account)
const admins = {}; // contract → role → admin role
const owners = {}; // contract → { owner, pendingOwner }
for (const l of logs) {
  const c = l.address.toLowerCase();
  if (l.eventName === "RoleGranted" || l.eventName === "RoleRevoked") {
    const role = names.get(l.args.role) ?? l.args.role;
    const set = ((holders[c] ??= {})[role] ??= new Set());
    if (l.eventName === "RoleGranted") set.add(l.args.account.toLowerCase());
    else set.delete(l.args.account.toLowerCase());
  } else if (l.eventName === "RoleAdminChanged") {
    (admins[c] ??= {})[names.get(l.args.role) ?? l.args.role] = names.get(l.args.newAdminRole) ?? l.args.newAdminRole;
  } else if (l.eventName === "OwnershipTransferred") {
    owners[c] = { ...(owners[c] ?? {}), owner: l.args.newOwner.toLowerCase(), pendingOwner: null };
  } else if (l.eventName === "OwnershipTransferStarted") {
    owners[c] = { ...(owners[c] ?? {}), pendingOwner: l.args.newOwner.toLowerCase() };
  }
}
const out = {
  network: dep.label,
  scanned: { fromBlock: from.toString(), toBlock: to.toString(), windows: windows.length, logs: logs.length },
  holders: Object.fromEntries(Object.entries(holders).map(([c, r]) => [c, Object.fromEntries(Object.entries(r).map(([k, s]) => [k, [...s]]))])),
  roleAdmins: admins,
  owners,
};
console.log(JSON.stringify(out, null, 2));
