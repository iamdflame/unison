#!/usr/bin/env node
/**
 * Weekend-gap study: how far each stock opens from its last close after the market has been shut for a weekend
 * (or a long weekend). Five years of daily bars from Yahoo Finance's public chart API (split-adjusted; weekends
 * spanning a split are skipped). Writes docs/evidence/weekend-gaps.{md,json}.
 *
 *   node research/weekend-gaps/gaps.mjs
 */
import { writeFileSync } from "node:fs";

const SYMBOLS = ["NVDA", "TSLA", "COIN", "MSTR", "SPY", "QQQ", "AAPL", "GLD"];
const THRESHOLD = 0.02;

async function bars(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5y&interval=1d&events=splits`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (unison research)" } });
    if (r.ok) {
      const j = await r.json();
      const res = j.chart.result[0];
      const q = res.indicators.quote[0];
      const splits = Object.values(res.events?.splits ?? {}).map((s) => s.date * 1000);
      const rows = res.timestamp
        .map((t, i) => ({ t: t * 1000, open: q.open[i], close: q.close[i] }))
        .filter((b) => Number.isFinite(b.open) && Number.isFinite(b.close));
      return { rows, splits };
    }
    await new Promise((s) => setTimeout(s, 1500 * (attempt + 1)));
  }
  throw new Error(`${symbol}: Yahoo chart API unavailable`);
}

const pct = (x) => Math.round(x * 1000) / 10;
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
};

const results = [];
for (const symbol of SYMBOLS) {
  const { rows, splits } = await bars(symbol);
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const days = (cur.t - prev.t) / 86_400_000;
    if (days < 2.5) continue; // weeknight, not a weekend
    if (splits.some((s) => s > prev.t && s <= cur.t + 86_400_000)) continue;
    gaps.push(Math.abs(cur.open / prev.close - 1));
  }
  results.push({
    symbol,
    from: new Date(rows[0].t).toISOString().slice(0, 10),
    to: new Date(rows.at(-1).t).toISOString().slice(0, 10),
    weekends: gaps.length,
    gappedPct: Math.round((gaps.filter((g) => g > THRESHOLD).length / gaps.length) * 100),
    meanPct: pct(gaps.reduce((a, b) => a + b, 0) / gaps.length),
    p99Pct: pct(quantile(gaps, 0.99)),
    maxPct: pct(Math.max(...gaps)),
  });
  console.log(results.at(-1));
}

const generated = new Date().toISOString().slice(0, 10);
writeFileSync(
  new URL("../../docs/evidence/weekend-gaps.json", import.meta.url),
  JSON.stringify({ generated, thresholdPct: THRESHOLD * 100, source: "Yahoo Finance daily bars (split-adjusted)", results }, null, 2) + "\n",
);

const md = `# Weekend gaps: how far stocks open from Friday's close (${generated})

**Script:** \`research/weekend-gaps/gaps.mjs\` (rerun any time; it rewrites this file and \`weekend-gaps.json\`).

**Data:** five years of daily bars from Yahoo Finance's public chart API (split-adjusted). A "weekend" is any break of 2.5 days or more between trading days, so long weekends count too. Weekends that span a stock split are skipped. The gap is |first open after the break ÷ last close before it − 1|.

| Symbol | Window | Weekends | Opened >2% away | Mean gap | p99 gap | Max gap |
|---|---|---:|---:|---:|---:|---:|
${results.map((r) => `| ${r.symbol} | ${r.from} → ${r.to} | ${r.weekends} | ${r.gappedPct}% | ${r.meanPct}% | ${r.p99Pct}% | ${r.maxPct}% |`).join("\n")}

## What it means for Unison

- Holders of these stocks carry this risk every weekend with no way to act on news until Monday's open.
- Unison's DISCOVERY regime runs call auctions while the primary market is closed. Its price band widens with the square root of the time since the close, so its cap tracks a p99-style weekend move (\`discCapBps\` in \`deploy/monad-mainnet.json\`).
- These are historical gaps, not forecasts.
`;
writeFileSync(new URL("../../docs/evidence/weekend-gaps.md", import.meta.url), md);
console.log("wrote docs/evidence/weekend-gaps.{md,json}");
