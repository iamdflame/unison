#!/usr/bin/env node
/**
 * Folds the standing challenge's record (contracts/script/DeployChallenge.s.sol) into a deployment record, under
 * `challenge`: the challenge on Unison's causal market, the one on the old-rule control, and the window.
 *
 *   node scripts/merge-challenge.mjs deployments/monad-mainnet.json deployments/monad-mainnet-challenge.json
 */
import { readFileSync, writeFileSync } from "node:fs";

const [depPath, recPath] = process.argv.slice(2);
if (!depPath || !recPath) {
  console.error("usage: merge-challenge.mjs <deployment.json> <challenge-record.json>");
  process.exit(2);
}
const dep = JSON.parse(readFileSync(depPath, "utf8"));
const rec = JSON.parse(readFileSync(recPath, "utf8"));
dep.challenge = { control: rec.control, end: rec.end, start: rec.start, unison: rec.unison };
const sorted = (v) =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
writeFileSync(depPath, JSON.stringify(sorted(dep), null, 2));
console.log(`merged ${recPath} into ${depPath}: unison ${rec.unison}, control ${rec.control}`);
