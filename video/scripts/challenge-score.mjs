/**
 * The standing challenge as the contracts judge it, right now: each side's fills and edge from Envio's table (the
 * same scoring as LatencyChallenge.edgeOf, matched to the unit), whether each pot was paid, and the Unison pot's
 * balance read from Monad itself. Writes src/data/challenge-live.json, which the film, the cards and the post copy
 * read, so no number on screen is older than the render.
 *
 *   node scripts/challenge-score.mjs        (from video/)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GRAPHQL = "https://indexer.dev.hyperindex.xyz/c37634b/v1/graphql";
const RPC = "https://rpc.monad.xyz";
const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";
const UNISON = "0xdcd3e86518db6a40c4feba576efff598ca3b90d1";
const CONTROL = "0x5ce9d9f491e2d16c94f56ed09bea23e7109976e9";

const gql = await fetch(GRAPHQL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: "{ Account { challenge_id fills counted edgeBps pendingMarks } Challenge { id paid claimTx } chain_metadata { latest_processed_block block_height } }",
  }),
}).then((r) => r.json());
const d = gql.data;
const meta = d.chain_metadata[0];
if (meta.latest_processed_block < meta.block_height - 50) throw new Error(`Envio is ${meta.block_height - meta.latest_processed_block} blocks behind: wait for it`);
const side = (id) => {
  const a = d.Account.find((x) => x.challenge_id === id);
  const c = d.Challenge.find((x) => x.id === id);
  if (!a || !c) throw new Error(`no account for ${id}`);
  if (a.pendingMarks) throw new Error(`${id}: ${a.pendingMarks} fills still wait for their markout`);
  return { fills: a.fills, bps: Number(a.edgeBps), paid: c.paid, claimTx: c.claimTx };
};

// balanceOf(UNISON) on AUSD (6 decimals), from the chain
const call = await fetch(RPC, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to: AUSD, data: "0x70a08231" + UNISON.slice(2).padStart(64, "0") }, "latest"],
  }),
}).then((r) => r.json());
const pot = Number(BigInt(call.result)) / 1e6;

const out = {
  asOf: new Date().toISOString(),
  block: meta.block_height,
  unison: { ...side(UNISON), pot },
  control: side(CONTROL),
};
writeFileSync(fileURLToPath(new URL("../src/data/challenge-live.json", import.meta.url)), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
