/**
 * Drives the real MCP server over stdio as an agent would, with a session key minted in the browser
 * (apps/web/scripts/flow-agents.mjs). Default: list tools, read the markets, place a resting order, find it,
 * cancel it. With EXPECT=rejected: a revoked key must not be able to place anything.
 *
 *   node scripts/agent-e2e.mjs <key.json>
 */
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const { account, privateKey } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const expectRejected = process.env.EXPECT === "rejected";
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--conditions=development", "src/main.ts"],
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
  env: {
    ...process.env,
    DEPLOYMENT: "../../deployments/31337.json",
    RPC_URL: process.env.RPC_URL ?? "http://127.0.0.1:8546",
    RELAYER_URL: process.env.RELAYER_URL ?? "http://127.0.0.1:8788",
    AGENT_ACCOUNT: account,
    AGENT_PRIVATE_KEY: privateKey,
  },
});
const client = new Client({ name: "unison-e2e", version: "0.0.0" });
await client.connect(transport);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return JSON.parse(r.content[0].text);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) process.exitCode = 1;
};

const tools = (await client.listTools()).tools.map((t) => t.name);
ok(["markets", "place_order", "cancel_order", "my_orders"].every((n) => tools.includes(n)), `tools: ${tools.join(", ")}`);

const placed = await call("place_order", { symbol: "aNVDA/AUSD", side: "buy", price: "178.00", qty: "1" });
if (expectRejected) {
  ok(placed.httpStatus >= 400 || !!placed.error, `revoked key rejected: ${JSON.stringify(placed.error ?? placed).slice(0, 160)}`);
} else {
  ok(placed.httpStatus < 300 && !!placed.id, `place_order accepted (job ${placed.id})`);
  let status;
  for (let i = 0; i < 40; i++) {
    status = await call("order_status", { id: placed.id });
    if (status.status === "done" || status.status === "failed") break;
    await sleep(500);
  }
  ok(status?.status === "done", `order_status: ${status?.status}${status?.error ? ` (${status.error})` : ""}`);
  const mine = await call("my_orders");
  ok(Array.isArray(mine) && mine.length > 0, `my_orders: ${mine.length} open`);
  const slot = Number(mine[0]?.slot);
  const cancelled = await call("cancel_order", { slot });
  ok(!!cancelled.id && !cancelled.error, `cancel_order slot ${slot} (job ${cancelled.id ?? cancelled.error})`);
  let open = mine.length;
  for (let i = 0; i < 40 && open > 0; i++) {
    await sleep(500);
    open = (await call("my_orders")).length;
  }
  ok(open === 0, `after cancel: ${open} open`);
}
await client.close();
