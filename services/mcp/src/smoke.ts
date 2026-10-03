/** Smoke test: spawns the MCP server over stdio (as an agent host would) and calls a few tools on the devnet. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--conditions=development", "src/main.ts"],
  env: { ...process.env, DEPLOYMENT: process.env.DEPLOYMENT ?? "../../deployments/31337.json" } as Record<string, string>,
});
const client = new Client({ name: "unison-smoke", version: "0.0.1" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
for (const [name, args] of [
  ["markets", {}],
  ["market", { symbol: "aNVDA/AUSD" }],
  ["depth", { symbol: "aNVDA/AUSD", levels: 40 }],
] as const) {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as { type: string; text: string }[];
  console.log(`\n# ${name}\n${content[0]?.text.slice(0, 900)}`);
}
await client.close();
