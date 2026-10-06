import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { facts } from "../lib/content/facts.ts";
import { MARKETS } from "../lib/content/markets.ts";

const repo = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const n = (x: number) => x.toLocaleString("en-US");

describe("every site number is backed by the evidence files", () => {
  const fairness = repo("docs/evidence/fairness.md");
  const gas = repo("docs/evidence/gas.md");
  const gaps = repo("docs/evidence/weekend-gaps.md");
  const audit = JSON.parse(repo("cre/unison/workflows/audit/config.production.json"));
  const halts = JSON.parse(repo("cre/unison/workflows/halts/config.production.json"));

  it("sniper P&L per venue", () => {
    expect(fairness).toMatch(new RegExp(String.raw`xy=k AMM[^|]*\| \$${n(facts.sniper.xyk)} \|`));
    expect(fairness).toMatch(new RegExp(String.raw`Push-oracle AMM[^|]*\| \$${n(facts.sniper.pushOracleAmm)} \|`));
    expect(fairness).toMatch(new RegExp(String.raw`CLOB \+ market makers[^|]*\| \$${n(facts.sniper.clob)} \|`));
    expect(fairness).toMatch(/\*\*Unison\*\* \(vault ±2 bp, fee 1 bp\) \| \*\*\$0\*\*/);
  });

  it("the whole benchmark table, row by row", () => {
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // a table cell, bold or not: "| $6,171 " or "| **$0** "
    const cell = (v: string) => `\\| (?:\\*\\*)?${esc(v)}(?:\\*\\*)? `;
    for (const r of facts.fairnessTable) {
      const row = new RegExp(`${esc(r.key)}[^\\n]*${cell(`$${n(r.sniper)}`)}${cell(`$${n(r.lp)}`)}${cell(`${r.noiseBps.toFixed(1)} bp`)}${cell(n(r.sniperFills))}\\|`);
      expect(fairness, r.key).toMatch(row);
    }
  });

  it("LP earnings at the same spread", () => {
    expect(fairness).toContain(`${facts.lp.multiple}×`);
    expect(fairness).toContain(`$${facts.lp.unisonVault}/day`);
    expect(fairness).toContain(`$${facts.lp.clobMakers}/day`);
    expect(fairness).toMatch(new RegExp(`${facts.noiseCostBps.unison} bp`));
  });

  it("gas and dollar costs", () => {
    expect(gas).toContain(n(facts.gas.clearMonad));
    expect(gas).toContain(n(facts.gas.clearEthereumRules));
    expect(gas).toContain(`${facts.gas.savingPct}% cheaper`);
    expect(gas).toContain(n(facts.gas.orderSteadyState));
    expect(gas).toContain(`$${facts.gas.batch200Usd}`);
    expect(gas).toContain(`$${facts.gas.orderUsd}`);
    expect(gas).toContain(`${facts.gas.baseFeeGwei} gwei minimum base fee and MON ≈ $${facts.gas.monUsd}`);
  });

  it("weekend gaps", () => {
    expect(gaps).toMatch(new RegExp(String.raw`\| NVDA \|[^\n]*\| ${facts.weekend.nvdaMondaysGappedPct}% \|`));
    expect(gaps).toMatch(new RegExp(String.raw`\| MSTR \|[^\n]*\| ${facts.weekend.mstrMondaysGappedPct}% \|`));
  });

  it("Chainlink CRE cadence and threshold", () => {
    expect(audit.schedule).toBe(`*/${facts.cre.auditEverySec} * * * * *`);
    expect(audit.maxDeviationBps).toBe(facts.cre.haltAboveBps);
    expect(halts.schedule).toBe("0 * * * * *");
  });

  it("the causal clock: waits and the old rule's gap, from Chainlink's history", () => {
    const causal = repo("docs/evidence/causal.md");
    const k = facts.causal;
    expect(causal).toMatch(new RegExp(String.raw`WMON/AUSD \| [^\n]*\| \*\*${k.wait["WMON/AUSD"]!.p50}\*\* \| ${k.wait["WMON/AUSD"]!.p90} \|`));
    expect(causal).toMatch(new RegExp(String.raw`in US market hours \| aNVDA/AUSD \|[^\n]*\*\*${k.wait["aNVDA/AUSD"]!.p50}\*\* \| ${k.wait["aNVDA/AUSD"]!.p90} \|`));
    expect(causal).toContain(`${k.wait["aNVDA/AUSD"]!.offHours}`);
    expect(causal).toContain(`over ${k.oldRuleGap.overBps} bp (WMON vault 20 bp + fee 3 bp): **${k.oldRuleGap.pctOfRounds}% of rounds, ${k.oldRuleGap.perHour} an hour**`);
    expect(causal).toContain(`${n(k.roundsChecked)} rounds`);
    expect(causal).toContain(`typically ${k.landsAfterSec} s before`);
    const cfg = JSON.parse(repo("deploy/monad-mainnet-causal.json"));
    expect(cfg.skewSec).toBe(k.skewSec);
  });

  it("calendar arithmetic", () => {
    expect((3_600_000 / facts.beatMs)).toBe(facts.batchesPerHour);
    expect(facts.hours.regularPerWeek).toBe(6.5 * 5);
  });

  it("the night cadence is the contract's", () => {
    // UnisonExchange's default discovery cadence, and every market the site lists uses it
    expect(repo("contracts/src/core/UnisonExchange.sol")).toMatch(new RegExp(`g\\.discCadence = ${facts.discoveryBlocks};`));
    for (const m of MARKETS) expect(m.regime.discCadence, m.ticker).toBe(facts.discoveryBlocks);
  });
});
