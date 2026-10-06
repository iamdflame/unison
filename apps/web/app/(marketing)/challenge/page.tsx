import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { challengeTerms } from "@unison/sdk";
import { Code } from "@/components/code/Code";
import { facts } from "@/lib/content/facts";
import { site } from "@/lib/content/site";
import { loadChallengers } from "@/lib/challenge/envio";
import { netConfig } from "@/lib/venue/config";

export const metadata: Metadata = {
  title: "The standing challenge",
  description:
    "A pot anyone can take who profits from being faster than Unison's price. The same open-source bot trades Unison and a market kept on the old rule, side by side; the contract pays whoever meets the definition.",
};

/** The pots and the scores move slowly: a minute is fresh enough, and it keeps the public RPC unbothered. */
export const revalidate = 60;

interface Leg {
  name: "unison" | "control";
  challenge: Address;
  account: Address;
  counted: string;
  fills: number;
  edgeBps: number;
  ready: boolean;
  claimTx: string | null;
}

async function load() {
  const net = netConfig("mainnet");
  const ch = net?.deployment.challenge as { unison: Address; control: Address; start: number; end: number } | undefined;
  if (!net || !ch) return null;
  const client = createPublicClient({ transport: http(net.rpcUrl) });
  // the pots and whether they were paid, from the chain itself
  let terms: Awaited<ReturnType<typeof challengeTerms>> | null = null;
  let pots = { unison: 0n, control: 0n };
  let paid = { unison: false, control: false };
  try {
    const [tU, tC] = await Promise.all([challengeTerms(client, ch.unison), challengeTerms(client, ch.control)]);
    const [pU, pC] = await Promise.all([
      client.readContract({ address: tU.pot, abi: erc20Abi, functionName: "balanceOf", args: [ch.unison] }),
      client.readContract({ address: tC.pot, abi: erc20Abi, functionName: "balanceOf", args: [ch.control] }),
    ]);
    terms = tU;
    pots = { unison: pU, control: pC };
    paid = { unison: tU.paid, control: tC.paid };
  } catch {
    /* the RPC didn't answer: the page still states the rules */
  }
  const url = process.env.NEXT_PUBLIC_MAINNET_ADVERSARY_URL;
  const board = url
    ? ((await fetch(`${url}/v1/score`, { next: { revalidate } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)) as { adversary: Address; thresholdBps: number; minGapSec?: number; updatedAt: string | null; legs: Leg[] } | null)
    : null;
  const challengers = await loadChallengers(revalidate);
  return { net, ch, terms, pots, paid, board, challengers };
}

const ausd = (units: bigint) => `${(Number(units) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} AUSD`;
const date = (sec: number | bigint) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(Number(sec) * 1000),
  ) + " UTC";

const ENTER = `import { latencyChallengeAbi, challengeAccountAbi, scoreAccount } from "@unison/sdk";

// 1. an account of your own, inside the challenge
await wallet.writeContract({ address: CHALLENGE, abi: latencyChallengeAbi, functionName: "open" });
const account = await client.readContract({ address: CHALLENGE, abi: latencyChallengeAbi,
  functionName: "accountOf", args: [you] });

// 2. fund it (approve the account first), then trade: one auction order at a time
await wallet.writeContract({ address: account, abi: challengeAccountAbi,
  functionName: "deposit", args: [AUSD, 10_000_000n] });            // 10 AUSD
await wallet.writeContract({ address: account, abi: challengeAccountAbi,
  functionName: "order", args: [0, tick, 10n ** 19n] });            // buy 10 WMON
// …after its auction runs, put the fill on the record
await wallet.writeContract({ address: account, abi: challengeAccountAbi, functionName: "settle" });

// 3. when your fills beat the definition, take the pot
const s = await scoreAccount(client, CHALLENGE, account);
if (s.qualifies) await wallet.writeContract({ address: CHALLENGE, abi: latencyChallengeAbi,
  functionName: "claim", args: [account, s.baseRounds, s.quoteRounds] });`;

export default async function ChallengePage() {
  const r = await load();
  const gap = facts.causal.oldRuleGap;
  const replay = facts.challenge;
  const bp = (x: number) => `${x < 0 ? "−" : "+"}${Math.abs(x).toFixed(1)}`;
  const explorer = r?.net.explorer?.replace(/\/$/, "");
  const link = (addr: string, label?: string) =>
    explorer ? (
      <a href={`${explorer}/address/${addr}`} className="figures text-ink underline decoration-line-strong underline-offset-4">
        {label ?? `${addr.slice(0, 8)}…${addr.slice(-6)}`}
      </a>
    ) : (
      <span className="figures">{label ?? addr}</span>
    );
  const leg = (name: "unison" | "control") => r?.board?.legs.find((l) => l.name === name);

  return (
    <article className="mx-auto max-w-[1100px] px-5 pt-36 pb-28 sm:px-8 lg:px-12 lg:pt-44">
      <p className="text-sm font-medium text-ink-3">The standing challenge · Monad mainnet</p>
      <h1 className="text-display-xl mt-3 max-w-3xl text-ink">Snipe us.</h1>
      <p className="text-lede mt-6 max-w-2xl text-ink-2">
        Anyone who makes money from being faster than Unison&apos;s price can take this pot. Our own sniper, open source,
        trades Unison and a market kept on the old rule side by side: the same signal, the same size, the same vault. The
        definition is in the contract, and the contract pays.
      </p>

      {r ? (
        <>
          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
            {(
              [
                ["unison", "Unison", "Each auction prices at the first price Chainlink observes after its orders are in."],
                ["control", "The old rule (control)", "Each auction prices at the Chainlink round already on chain when it clears."],
              ] as const
            ).map(([name, title, rule]) => {
              const l = leg(name);
              const paid = r.paid[name];
              return (
                <section key={name} aria-labelledby={`${name}-title`} className="rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel">
                  <h2 id={`${name}-title`} className="text-[15px] font-semibold text-ink">
                    {title}
                  </h2>
                  <p className="mt-1 text-sm text-ink-3">{rule}</p>
                  <dl className="mt-5 space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-ink-3">Pot</dt>
                      <dd className="figures font-semibold text-ink">{paid ? "Paid out" : ausd(r.pots[name])}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-ink-3">Our sniper&apos;s fills</dt>
                      <dd className="figures text-ink">{l ? l.counted : "Not scored yet"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-ink-3">Its edge, after fees</dt>
                      <dd className={`figures font-semibold ${l && l.edgeBps > 0 ? "text-buy" : "text-ink"}`}>
                        {l && Number(l.counted) > 0 ? `${l.edgeBps > 0 ? "+" : ""}${l.edgeBps.toFixed(2)} bp a trade` : "None yet"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-ink-3">Contract</dt>
                      <dd>{link(r.ch[name])}</dd>
                    </div>
                    {l?.claimTx ? (
                      <div className="flex justify-between gap-4">
                        <dt className="text-ink-3">Claimed</dt>
                        <dd>
                          {explorer ? (
                            <a href={`${explorer}/tx/${l.claimTx}`} className="figures text-ink underline decoration-line-strong underline-offset-4">
                              {l.claimTx.slice(0, 10)}…
                            </a>
                          ) : (
                            l.claimTx
                          )}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </section>
              );
            })}
          </div>
          <p className="mt-4 text-sm text-ink-3">
            Each edge is every fill marked to the first Chainlink observation at least {String(r.terms?.horizonSec ?? 60)} s after its order.
            {r.board?.updatedAt ? ` Scored ${date(Math.floor(Date.parse(r.board.updatedAt) / 1000))}.` : ""}
          </p>

          {r.challengers?.length ? (
            <section aria-labelledby="everyone-title" className="mt-16">
              <h2 id="everyone-title" className="text-display-s text-ink">
                Every challenger
              </h2>
              <p className="mt-3 max-w-2xl text-ink-2">
                Every account opened in either challenge, scored as the contract would judge its claim: each fill marked to the
                first Chainlink observation at least {String(r.terms?.horizonSec ?? 60)} s after its order. Indexed from Monad
                mainnet by Envio HyperIndex.{" "}
                <a href={`${site.repo}/tree/main/services/indexer`} className="text-ink underline decoration-line-strong underline-offset-4">
                  The indexer
                </a>
                .
              </p>
              <div className="mt-6 overflow-x-auto rounded-[var(--radius-xl)] bg-raised shadow-panel">
                <table className="w-full text-left text-sm">
                  <thead className="text-ink-3">
                    <tr className="border-b border-line">
                      <th scope="col" className="px-4 py-3 font-medium sm:px-5">Account</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium sm:px-5">Edge after fees</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium sm:px-5">Counted fills</th>
                      <th scope="col" className="hidden px-5 py-3 text-right font-medium sm:table-cell">Traded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {r.challengers.map((c) => {
                      const ours = c.owner === r.net.deployment.adversary?.address.toLowerCase();
                      const rule = c.rule === "causal" ? "Unison" : c.rule === "old" ? "Old rule" : "Unknown";
                      return (
                        <tr key={c.account}>
                          <td className="px-4 py-3 sm:px-5">
                            <span className="whitespace-nowrap">{link(c.account)}</span>
                            <span className="mt-0.5 block text-xs text-ink-3">
                              {rule}
                              {ours ? " · our sniper" : ""}
                            </span>
                          </td>
                          <td className={`figures whitespace-nowrap px-4 py-3 text-right font-semibold sm:px-5 ${c.edgeBps > 0 ? "text-buy" : "text-ink"}`}>
                            {c.counted ? `${c.edgeBps > 0 ? "+" : ""}${c.edgeBps.toFixed(2)} bp` : "—"}
                          </td>
                          <td className="figures whitespace-nowrap px-4 py-3 text-right text-ink sm:px-5">
                            {c.counted} of {String(r.terms?.minFills ?? 30)}
                            {c.pendingMarks ? <span className="block text-xs text-ink-3">+{c.pendingMarks} awaiting markout</span> : null}
                          </td>
                          <td className="figures hidden whitespace-nowrap px-5 py-3 text-right text-ink sm:table-cell">{ausd(c.notional)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section aria-labelledby="terms-title" className="mt-16">
            <h2 id="terms-title" className="text-display-s text-ink">
              The definition
            </h2>
            <p className="mt-3 max-w-2xl text-ink-2">
              Frozen in the contract when it was deployed. Directional luck averages out over this many fills; knowing the
              next price first does not.
            </p>
            <dl className="mt-6 divide-y divide-line rounded-[var(--radius-xl)] bg-raised text-sm shadow-panel">
              {(
                [
                  ["Window", r.terms ? `${date(r.terms.start)} → ${date(r.terms.end)}` : `${date(r.ch.start)} → ${date(r.ch.end)}`],
                  ["Markout", `Each fill, at the first Chainlink MON/USD observation at least ${String(r.terms?.horizonSec ?? 60)} s after its order, proven first from the feed's history`],
                  ["Wins", `An average edge after fees above ${r.terms?.epsilonBps ?? 2} bp, over at least ${String(r.terms?.minFills ?? 30)} fills`],
                  ["Every fill counts", "Trades go through your challenge account, which records each one; a claim can't leave the losing ones out"],
                  ["Who can't enter", "The venue's own keys, the owner's passkey account and wallet"],
                  ["If nobody wins", "Three days after the window, the pot goes back to its sponsor: the rule held"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="enter-title" className="mt-16">
            <h2 id="enter-title" className="text-display-s text-ink">
              Take it
            </h2>
            <p className="mt-3 max-w-2xl text-ink-2">
              Open an account in the challenge, fund it, trade through it, and claim when your fills meet the definition. The
              Unison challenge is {link(r.ch.unison)}; the control is {link(r.ch.control)}.
            </p>
            <div className="mt-5">
              <Code code={ENTER} title="take-the-pot.ts" />
            </div>
            <p className="mt-5 max-w-2xl text-ink-2">
              An AI agent can do the same from MetaMask&apos;s Agent Wallet CLI, signing with its own wallet:{" "}
              <code className="figures text-ink">mm unison challenge open</code>, then <code className="figures text-ink">fund</code>,{" "}
              <code className="figures text-ink">order --settle</code>, <code className="figures text-ink">score</code> and{" "}
              <code className="figures text-ink">claim</code>.{" "}
              <a href={`${site.repo}/tree/main/integrations/agent-wallet-plugin`} className="text-ink underline decoration-line-strong underline-offset-4">
                The plugin
              </a>
              .
            </p>
          </section>

          <section aria-labelledby="bot-title" className="mt-16">
            <h2 id="bot-title" className="text-display-s text-ink">
              Our sniper
            </h2>
            <p className="mt-3 max-w-2xl text-ink-2">
              It watches MON on Coinbase and Kraken. When the price has moved more than{" "}
              {r.board?.thresholdBps ?? 40} bp from Chainlink&apos;s last landed round (the vaults&apos; spread and fee, and a
              margin), it trades toward the move on both markets at once
              {r.board?.minGapSec ? `, at most once every ${Math.round(r.board.minGapSec / 60)} minutes (each trade pays the keeper for a clear on each market)` : ""}. It
              counts as the team&apos;s in every tally of outside demand, and it may claim, so the definition is shown to pay
              where there is an edge. Once a challenge has paid out, it stops trading that market.
              {r.board?.adversary ? <> Its address is {link(r.board.adversary)}.</> : null}{" "}
              <a href={`${site.repo}/tree/main/services/adversary`} className="text-ink underline decoration-line-strong underline-offset-4">
                Its source
              </a>
              .
            </p>
          </section>
        </>
      ) : (
        <p className="mt-12 max-w-2xl text-ink-2">The challenge opens with Unison&apos;s causal markets on Monad mainnet.</p>
      )}

      <section aria-labelledby="why-title" className="mt-16">
        <h2 id="why-title" className="text-display-s text-ink">
          Why the old rule pays
        </h2>
        <p className="mt-3 max-w-2xl text-ink-2">
          A Chainlink observation takes about {facts.causal.landsAfterSec} s to land on chain, and anyone watching the
          market sees the move before it lands. Measured on MON/USD, {gap.pctOfRounds}% of observations moved more than the
          WMON vault&apos;s {gap.overBps} bp of spread and fee: {gap.perHour} chances an hour to trade against a price that
          was already old. Unison&apos;s auctions price at the observation made after their orders, so those chances are gone
          by construction.{" "}
          <a href={`${site.repo}/blob/main/docs/evidence/causal.md`} className="text-ink underline decoration-line-strong underline-offset-4">
            The measurements
          </a>
          ; <Link href="/fairness" className="text-ink underline decoration-line-strong underline-offset-4">the record</Link>.
        </p>
      </section>

      <section aria-labelledby="replay-title" className="mt-16">
        <h2 id="replay-title" className="text-display-s text-ink">
          Our sniper, against last week
        </h2>
        <p className="mt-3 max-w-2xl text-ink-2">
          Before funding either pot, we replayed the bot over a week of real prices: {replay.trades.toLocaleString("en-US")}{" "}
          Coinbase trades against {replay.rounds.toLocaleString("en-US")} Chainlink rounds. At its settings (
          {replay.thresholdBps} bp, at most once every {replay.gapMin} minutes) it earned {bp(replay.oldRule.edgeBps)} bp a
          trade on the old rule, {replay.oldRule.winsPct}% of trades winning: enough to claim the control&apos;s pot in about{" "}
          {Math.round(replay.oldRule.qualifiesH)} hours. On the causal rule the same trades lost {Math.abs(replay.causal.edgeBps).toFixed(1)} bp
          each, and its best run of 30 fills or more was {bp(replay.causal.bestPrefixBps)} bp; the pot pays only above +2 bp.{" "}
          <a href={`${site.repo}/blob/main/docs/evidence/challenge.md`} className="text-ink underline decoration-line-strong underline-offset-4">
            The replay, at every setting
          </a>
          .
        </p>
      </section>
    </article>
  );
}
