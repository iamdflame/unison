import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { facts } from "../lib/content/facts.ts";

const repo = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const n = (x: number) => x.toLocaleString("en-US");

describe("every site number is backed by the evidence files", () => {
  const fairness = repo("docs/evidence/fairness.md");
  const gas = repo("docs/evidence/gas.md");
  const gaps = repo("docs/evidence/weekend-gaps.md");
  const audit = JSON.parse(repo("cre/unison/workflows/audit/config.production.json"));
  const halts = JSON.parse(repo("cre/unison/workflows/halts/config.production.json"));

  it("sniper P&L per venue", () => {
    expect(fairness).toMatch(new RegExp(`xy=k AMM[^|]*\| \$${n(facts.sniper.xyk)} \|`));
    expect(fairness).toMatch(new RegExp(`Push-oracle AMM[^|]*\| \$${n(facts.sniper.pushOracleAmm)} \|`));
    expect(fairness).toMatch(new RegExp(`CLOB \+ market makers[^|]*\| \$${n(facts.sniper.clob)} \|`));
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
  });

  it("weekend gaps", () => {
    expect(gaps).toMatch(new RegExp(`\| NVDA \|[^\n]*\| ${facts.weekend.nvdaMondaysGappedPct}% \|`));
    expect(gaps).toMatch(new RegExp(`\| MSTR \|[^\n]*\| ${facts.weekend.mstrMondaysGappedPct}% \|`));
  });

  it("Chainlink CRE cadence and threshold", () => {
    expect(audit.schedule).toBe(`*/${facts.cre.auditEverySec} * * * * *`);
    expect(audit.maxDeviationBps).toBe(facts.cre.haltAboveBps);
    expect(halts.schedule).toBe("0 * * * * *");
  });

  it("calendar arithmetic", () => {
    expect((3_600_000 / facts.beatMs)).toBe(facts.batchesPerHour);
    expect(facts.batchesPerHour * 24).toBe(facts.batchesPerDay);
    expect(facts.hours.regularPerWeek).toBe(6.5 * 5);
  });
});
