/**
 * Records a real session of mm-plugin-unison in MetaMask's `mm` CLI on Monad mainnet, command by command: what was
 * typed, what came back, and when, into src/data/mm-live.json. The MetaMask film replays it line for line.
 *
 * The agent wallet deposits 10 WMON (wrapping its MON), sells them in a sealed auction, checks the receipt from
 * the chain, and withdraws what it has on Unison. About $0.29 of MON is traded; gas is a fraction of a cent.
 *
 *   node capture/mm-session.mjs                (from video/; needs `mm` signed in, mm-plugin-unison installed)
 *   SLIPPAGE=150 node capture/mm-session.mjs   a wider limit (bp from Chainlink's price) when the market is moving
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MM = process.env.MM_ENTRY ?? join(dirname(process.execPath), "node_modules", "@metamask", "agent-wallet", "dist", "index.js");
const steps = [];
const slip = process.env.SLIPPAGE ? ` --slippage ${process.env.SLIPPAGE}` : "";

function mm(line) {
  const args = line.split(" ");
  const started = Date.now();
  // mm writes its progress (the intent it signs, each step) to stderr and its result to stdout: keep both
  const r = spawnSync(process.execPath, [MM, ...args], { encoding: "utf8", maxBuffer: 16 << 20 });
  const clean = (x) => (x ?? "").replace(/\r\n/g, "\n").trimEnd();
  const step = { command: `mm ${line}`, started: new Date(started).toISOString(), seconds: (Date.now() - started) / 1000, progress: clean(r.stderr), output: clean(r.stdout) };
  steps.push(step);
  console.log(`$ ${step.command}   (${step.seconds.toFixed(1)} s)\n${step.progress ? `${step.progress}\n` : ""}${step.output}\n`);
  writeFileSync(join(ROOT, "src", "data", "mm-live.json"), `${JSON.stringify({ wallet: "MetaMask Agent Wallet (server wallet)", network: "Monad mainnet (143)", steps }, null, 2)}\n`);
  return `${step.progress}\n${step.output}`;
}

mm("unison balance");
mm("unison markets");
mm("unison deposit 10 WMON");
mm(`unison quote WMON sell 10${slip}`);
const sold = mm(`unison order WMON sell 10${slip}`);
const receipt = sold.match(/https:\/\/www\.unisonfi\.com\/receipt\/mainnet\/\d+\/\d+/)?.[0];
if (receipt) mm(`unison receipt ${receipt}`);
mm("unison withdraw all AUSD");
mm("unison withdraw all WMON");
mm("unison balance");
