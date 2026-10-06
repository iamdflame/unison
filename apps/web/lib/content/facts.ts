/**
 * Every number the website states, with the file that proves it. test/facts.test.ts re-reads those files, so
 * the site cannot drift from the evidence. If a number isn't here, the site doesn't say it.
 */
export const facts = {
  /** One batch per Monad block while the reference market trades. docs/MONAD.md; measured 293–304 ms (Oct 2026). */
  beatMs: 300,
  /** ...so 12,000 batches an hour in session (a watchmaker's 12,000 A/h, which is 1.67 Hz). */
  batchesPerHour: 12_000,
  /**
   * While the reference market is closed (DISCOVERY: nights, weekends, holidays) a market holds one call auction
   * every `discoveryBlocks` blocks, about 3 s. contracts/src/core/UnisonExchange.sol (discCadence).
   */
  discoveryBlocks: 10,

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
    /** the dollar figures' basis: Monad's minimum base fee and the MON price used in docs/evidence/gas.md */
    baseFeeGwei: 100,
    monUsd: 0.034,
  },

  /** docs/evidence/weekend-gaps.md (5 years of daily data). */
  weekend: { nvdaMondaysGappedPct: 24, mstrMondaysGappedPct: 53, gapThresholdPct: 2 },
  /** NYSE regular session: 6.5 h × 5 days. */
  hours: { regularPerWeek: 32.5, week: 168 },

  /** cre/unison/workflows/*\/config.production.json */
  cre: { auditEverySec: 30, haltAboveBps: 75, haltMirrorEverySec: 60 },
  /** cre/unison/workflows/sentinel/config.production.json: the causal mainnet's feed sentinel (docs/evidence/cre.md) */
  sentinel: { everySec: 30, haltAboveBps: 75, silentSec: 120 },

  /** contracts/src/core/ExchangeLayout.sol MAX_ORDERS; deploy/monad-mainnet.json */
  limits: { openOrdersPerAccount: 55, markets: 10 },

  /**
   * The causal clock (SPEC §7.4): an auction prices at the first Chainlink observation after its orders were sealed.
   * Measured from the feeds' own history on Monad mainnet, 6 Oct 2026 (apps/web/scripts/measure-causal.mjs).
   * docs/evidence/causal.md; skewSec is deploy/monad-mainnet-causal.json.
   */
  causal: {
    skewSec: 2,
    /** observation to on chain, p50 */
    landsAfterSec: 13,
    roundsChecked: 8_100,
    /** an order's wait for the first observation after it, on chain */
    wait: {
      "WMON/AUSD": { p50: "34 s", p90: "1.2 min", when: "around the clock" },
      "aNVDA/AUSD": { p50: "1.5 min", p90: "5.3 min", when: "in US market hours", offHours: "15.2 min" },
    } as Record<string, { p50: string; p90: string; when: string; offHours?: string }>,
    /** the old rule: observations that moved more than the WMON vault's spread + fee (23 bp) */
    oldRuleGap: { overBps: 23, pctOfRounds: 6.1, perHour: 5.3 },
  },

  /**
   * The house sniper replayed over a week of real prices on both rules, at its live settings
   * (services/adversary/scripts/backtest.mjs, 6 Oct 2026): docs/evidence/challenge.md.
   */
  challenge: {
    trades: 208_414,
    rounds: 15_992,
    thresholdBps: 40,
    gapMin: 30,
    oldRule: { edgeBps: 17.8, winsPct: 72, qualifiesH: 33.1 },
    causal: { edgeBps: -23.0, bestPrefixBps: -15.8 },
  },
} as const;

/**
 * The benchmark at the vault's shipped setting (aNVDA's: ±10 bp, 3 bp fee) and the order book it is compared with.
 * Lead with these: the ±2 bp row is a setting no live vault runs, so it is only ever quoted as a hypothetical.
 */
export const shipped = {
  vault: facts.fairnessTable.find((r) => r.key === "vault ±10 bp, fee 3 bp")!,
  clob: facts.fairnessTable.find((r) => r.key === "CLOB + market makers")!,
} as const;

/** How long a causal market's next price typically takes, for a sentence ("typically 34 s"). */
export function causalWait(symbol: string): { p50: string; p90: string; when: string; offHours?: string } | null {
  return facts.causal.wait[symbol] ?? null;
}

export const sources = {
  sniper: "docs/evidence/fairness.md",
  lp: "docs/evidence/fairness.md",
  gas: "docs/evidence/gas.md",
  weekend: "docs/evidence/weekend-gaps.md",
  cre: "cre/unison/workflows/audit/config.production.json",
  causal: "docs/evidence/causal.md",
  challenge: "docs/evidence/challenge.md",
} as const;

/** "$6,171" */
export const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 0 })}`;
