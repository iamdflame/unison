/**
 * Every number the website states, with the file that proves it. test/facts.test.ts re-reads those files, so
 * the site cannot drift from the evidence. If a number isn't here, the site doesn't say it.
 */
export const facts = {
  /** One batch per Monad block. docs/MONAD.md; measured 293–304 ms on testnet/mainnet (Oct 2026). */
  beatMs: 300,
  batchesPerHour: 12_000,
  batchesPerDay: 288_000,

  /** Latency-sniper benchmark, per day. docs/evidence/fairness.md */
  sniper: { xyk: 6_171, pushOracleAmm: 473, clob: 487, unison: 0, unisonFills: 0 },
  /** Same ±2 bp quote: what liquidity keeps per day. docs/evidence/fairness.md */
  lp: { spreadBps: 2, unisonVault: 646, clobMakers: 84, multiple: 7.7 },
  /** Uninformed-trader cost at that same quote (stated so we never pair "7.7× LP" with "cheaper to trade"). */
  noiseCostBps: { unison: 3.3, clob: 2.0 },
  benchmark: { blocks: 1_000_000, hours: 83, sigmaPct: 45, jumpsPerDay: 24, jumpBps: 40, lpCapital: 2_000_000 },
  /** The whole benchmark, per day, one row per venue. `key` is the row label in docs/evidence/fairness.md. */
  fairnessTable: [
    { key: "xy=k AMM", venue: "Constant-product AMM", setup: "fee 30 bp", sniper: 6_171, lp: 13_459, noiseBps: 69.1, sniperFills: 12_563 },
    { key: "Push-oracle AMM", venue: "Oracle AMM", setup: "±10 bp, 50 bp push trigger", sniper: 473, lp: 2_175, noiseBps: 9.3, sniperFills: 63 },
    { key: "CLOB + market makers", venue: "Order book", setup: "makers ±2 bp, half the races lost", sniper: 487, lp: 84, noiseBps: 2.0, sniperFills: 5 },
    { key: "vault ±10 bp, fee 3 bp", venue: "Unison", setup: "vault ±10 bp, fee 3 bp", sniper: 0, lp: 2_858, noiseBps: 13.0, sniperFills: 0 },
    { key: "vault ±2 bp, fee 1 bp", venue: "Unison", setup: "vault ±2 bp, fee 1 bp", sniper: 0, lp: 646, noiseBps: 3.3, sniperFills: 0 },
    { key: "stale", venue: "Unison, rule broken", setup: "reference published before the batch closed", sniper: 1_000, lp: 1_740, noiseBps: 13.0, sniperFills: 8 },
  ],

  /** docs/evidence/gas.md */
  gas: {
    clearMonad: 1_766_599,
    clearEthereumRules: 3_014_026,
    savingPct: 41,
    orderSteadyState: 132_650,
    batch200Usd: 0.02,
    orderUsd: 0.0005,
  },

  /** docs/evidence/weekend-gaps.md (5 years of daily data). */
  weekend: { nvdaMondaysGappedPct: 24, mstrMondaysGappedPct: 53, gapThresholdPct: 2 },
  /** NYSE regular session: 6.5 h × 5 days. */
  hours: { regularPerWeek: 32.5, week: 168 },

  /** cre/unison/workflows/*\/config.production.json */
  cre: { auditEverySec: 30, haltAboveBps: 75, haltMirrorEverySec: 60 },

  /** contracts/src/core/ExchangeLayout.sol MAX_ORDERS; deploy/monad-mainnet.json */
  limits: { openOrdersPerAccount: 55, markets: 10 },
} as const;

export const sources = {
  sniper: "docs/evidence/fairness.md",
  lp: "docs/evidence/fairness.md",
  gas: "docs/evidence/gas.md",
  weekend: "docs/evidence/weekend-gaps.md",
  cre: "cre/unison/workflows/audit/config.production.json",
} as const;

/** "$6,171" */
export const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 0 })}`;
