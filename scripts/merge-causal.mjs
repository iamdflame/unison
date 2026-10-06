#!/usr/bin/env node
/**
 * Folds the causal cutover's record (contracts/script/UpgradeCausal.s.sol) into a deployment record (SPEC §7.4):
 * the new implementation and adapter, the causal markets' reference kind, and the old-rule control market.
 *
 *   node scripts/merge-causal.mjs deployments/monad-mainnet.json deployments/monad-mainnet-causal.json deploy/monad-mainnet-causal.json
 */
import { readFileSync, writeFileSync } from "node:fs";

const [depPath, recPath, cfgPath] = process.argv.slice(2);
if (!depPath || !recPath || !cfgPath) {
  console.error("usage: merge-causal.mjs <deployment.json> <causal-record.json> <causal-config.json>");
  process.exit(2);
}
const dep = JSON.parse(readFileSync(depPath, "utf8"));
const rec = JSON.parse(readFileSync(recPath, "utf8"));
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));

dep.exchangeImplementation = rec.exchangeImplementation;
dep.causalReference = rec.causalReference;
dep.skewSec = rec.skewSec;
dep.causalStartBlock = rec.startBlock;
const causalIds = new Set(cfg.causal.map((c) => c.id));
for (const m of Object.values(dep.markets)) if (causalIds.has(m.id)) m.reference = "chainlink-causal";

const c = cfg.control;
const twin = Object.values(dep.markets).find((m) => m.base.toLowerCase() === c.base.toLowerCase() && m.id !== rec.controlId);
dep.markets[rec.controlSymbol] = {
  base: c.base,
  control: true,
  id: rec.controlId,
  quote: c.quote,
  reference: "chainlink",
  ...(twin?.seedPrice !== undefined ? { seedPrice: twin.seedPrice } : {}),
  symbol: rec.controlSymbol,
  vault: rec.controlVault,
};

// forge writes keys sorted; keep the record diffable
const sorted = (v) =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
writeFileSync(depPath, JSON.stringify(sorted(dep), null, 2));
console.log(`merged ${recPath} into ${depPath}: causal markets ${[...causalIds].join(", ")}, control ${rec.controlId}`);
