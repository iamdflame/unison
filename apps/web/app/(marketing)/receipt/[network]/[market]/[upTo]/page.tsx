import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Address, Hex } from "viem";
import type { Print } from "@unison/sdk/tape";
import { LightReader } from "@unison/sdk/light";
import { Code } from "@/components/code/Code";
import { ReceiptCheck } from "@/components/receipt/ReceiptCheck";
import { netConfig, networkName, type Network } from "@/lib/venue/config";

/**
 * One auction's receipt, as a plain page: no wallet. The three times in order (the newest order sealed, Chainlink
 * observed the price, the auction cleared), every field the receipt hash commits to, the same checks run again from
 * the chain by the reader's own browser (ReceiptCheck), and the commands that run them from a terminal. The numbers
 * on the page are the tape's; the browser's check is the chain's, and says so when they differ. A receipt never
 * changes once its auction is final, so the page is cached.
 */
export const revalidate = 3600;

interface Params {
  network: string;
  market: string;
  upTo: string;
}

const NETWORKS: readonly Network[] = ["mainnet", "testnet", "devnet"];

async function load(params: Params) {
  const network = NETWORKS.find((n) => n === params.network);
  const marketId = Number(params.market);
  const upTo = Number(params.upTo);
  if (!network || !Number.isSafeInteger(marketId) || !Number.isSafeInteger(upTo) || marketId < 0 || upTo < 0) return null;
  const net = netConfig(network);
  if (!net) return null;
  const res = await fetch(`${net.tapeUrl}/v1/markets/${marketId}/prints?before=${upTo + 1}&limit=1`, { next: { revalidate } }).catch(() => null);
  if (!res?.ok) return null;
  const { prints } = (await res.json()) as { prints: Print[] };
  const p = prints[0];
  if (!p || p.upTo !== upTo) return null;
  const market = Object.values(net.deployment.markets).find((m) => m.id === marketId);
  const causalRef = net.deployment.causalReference as Address | undefined;
  const feed =
    p.round && causalRef
      ? await new LightReader(net.rpcUrl, net.deployment.exchange, (u, i) => fetch(u, { ...i, next: { revalidate: 86_400 } }))
          .causalFeed(causalRef, BigInt(marketId))
          .catch(() => null)
      : null;
  const decimalsOf = (addr: string | undefined) =>
    Object.values(net.deployment.tokens ?? {}).find((t) => t.address.toLowerCase() === addr?.toLowerCase())?.decimals;
  return {
    net,
    p,
    symbol: market?.symbol ?? `market ${marketId}`,
    control: !!market?.control,
    baseDecimals: decimalsOf(market?.base) ?? 18,
    quoteDecimals: decimalsOf(market?.quote) ?? 6,
    feed,
  };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const r = await load(await params);
  if (!r) return { title: "Receipt" };
  return {
    title: `Receipt · ${r.symbol} · block ${r.p.upTo.toLocaleString("en-US")}`,
    description: `One Unison auction on ${networkName(r.net.network)}: when it sealed, when Chainlink observed its price, when it cleared, and how to check it.`,
  };
}

const utc = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const when = (ms: number) => `${utc.format(new Date(ms))} UTC`;
const gap = (ms: number) =>
  ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 5_400_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 3_600_000).toFixed(1)} h`;
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

export default async function ReceiptPage({ params }: { params: Promise<Params> }) {
  const r = await load(await params);
  if (!r) notFound();
  const { p, net, feed } = r;
  const price = (units: string | bigint) => {
    const v = Number(units) / 10 ** r.quoteDecimals;
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: v < 1 ? 6 : 2, maximumFractionDigits: v < 1 ? 6 : 2 })}`;
  };
  const volume = (Number(p.volume) / 10 ** r.baseDecimals).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const base = r.symbol.split("/")[0];
  const traded = p.volume !== "0";
  const rule = p.rule ?? (p.round ? "causal" : "clear-time");
  const causal = rule === "causal";
  const discovery = rule === "discovery";
  const halted = p.status === 3;
  const bound = causal || discovery;
  const sealedMs = p.sealedAt != null ? p.sealedAt * 1000 : null;
  const observedAfter = sealedMs !== null ? p.refTimeMs - sealedMs : null;
  const explorer = net.explorer?.replace(/\/$/, "");
  const verdict = halted
    ? "No auction ran, so nothing traded, and every order that waited for it was returned."
    : discovery
      ? `The market was closed, so this was a call auction at Chainlink's last observation${observedAfter !== null && observedAfter < 0 ? `, made ${gap(-observedAfter)} before the newest order in it` : ""}. Nobody could know a newer price: none existed yet.`
      : causal
        ? p.causal
          ? `Chainlink observed this price ${gap(observedAfter ?? 0)} after the newest order in the auction was sealed. Nobody in it could have known the price it would clear against.`
          : "The tape could not confirm that the observation came after the seal. Your browser checks it below."
        : "This auction ran under the older rule: its reference time is the clear's own time, not an observation's.";

  return (
    <article className="mx-auto max-w-[1100px] px-5 pt-36 pb-28 sm:px-8 lg:px-12 lg:pt-44">
      <p className="text-sm font-medium text-ink-3">
        {r.symbol} · auction of block {p.upTo.toLocaleString("en-US")} · {networkName(net.network)}
        {r.control ? " · the old-rule control market" : ""}
      </p>
      <h1 className="text-display-l mt-3 max-w-3xl text-ink">
        {traded ? `${volume} ${base} at ${price(p.price)}.` : halted ? "Trading was halted." : "No trade in this auction."}
      </h1>
      <p className="text-lede mt-5 max-w-2xl text-ink-2">
        {traded
          ? "Every order that traded here got this one price. "
          : halted
            ? ""
            : "Buyers and sellers didn't meet inside the band; every order that waited for it was returned. "}
        {verdict}
      </p>

      <ol className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="The auction's three times">
        <li className="rounded-[var(--radius-xl)] bg-raised p-5 shadow-panel">
          <p className="text-xs font-medium text-ink-3">1 · Sealed</p>
          <p className="figures mt-1.5 text-[15px] font-semibold text-ink">{sealedMs !== null ? when(sealedMs) : "Unknown"}</p>
          <p className="mt-1.5 text-sm text-ink-2">The newest order in the auction was registered in block {p.upTo.toLocaleString("en-US")}.</p>
        </li>
        <li className="rounded-[var(--radius-xl)] bg-raised p-5 shadow-panel">
          <p className="text-xs font-medium text-ink-3">
            2 · {causal ? "Chainlink observed the price" : discovery ? "Chainlink's last observation" : "Reference time"}
          </p>
          <p className="figures mt-1.5 text-[15px] font-semibold text-ink">
            {when(p.refTimeMs)}
            {observedAfter !== null && causal ? <span className="font-normal text-ink-3"> · {gap(observedAfter)} later</span> : null}
            {observedAfter !== null && discovery && observedAfter < 0 ? (
              <span className="font-normal text-ink-3"> · {gap(-observedAfter)} before the seal</span>
            ) : null}
          </p>
          <p className="mt-1.5 text-sm text-ink-2">
            {causal
              ? `${price(p.refPrice)}, round ${p.round} of Chainlink's feed. The time is inside the report Chainlink's oracles signed.`
              : discovery
                ? `${price(p.refPrice)}, round ${p.round}: the newest price Chainlink had published. The market was closed, so no newer one came.`
                : `${price(p.refPrice)}, read when the auction cleared.`}
          </p>
        </li>
        <li className="rounded-[var(--radius-xl)] bg-raised p-5 shadow-panel">
          <p className="text-xs font-medium text-ink-3">3 · Cleared</p>
          <p className="figures mt-1.5 text-[15px] font-semibold text-ink">
            {when(p.ts)}
            {causal ? <span className="font-normal text-ink-3"> · {gap(p.ts - p.refTimeMs)} later</span> : null}
          </p>
          <p className="mt-1.5 text-sm text-ink-2">
            In block {p.block.toLocaleString("en-US")}, transaction{" "}
            {explorer ? (
              <a href={`${explorer}/tx/${p.tx}`} className="figures text-ink underline decoration-line-strong underline-offset-4">
                {short(p.tx)}
              </a>
            ) : (
              <span className="figures">{short(p.tx)}</span>
            )}
            .
          </p>
        </li>
      </ol>

      <dl className="mt-10 divide-y divide-line rounded-[var(--radius-xl)] bg-raised text-sm shadow-panel">
        {(
          [
            ["Price", traded ? price(p.price) : "No trade"],
            ["Reference", price(p.refPrice)],
            ["Against the reference", p.deviationBps === null ? "No trade" : `${p.deviationBps > 0 ? "+" : ""}${p.deviationBps.toFixed(2)} bp`],
            ["Volume", `${volume} ${base}`],
            ["Regime", p.regime],
            [
              "Rule",
              halted
                ? "Halted: no auction, every waiting order returned"
                : causal
                  ? "Priced at the first Chainlink observation after the auction sealed"
                  : discovery
                    ? "A call auction while the market was closed, at Chainlink's last observation, inside a band that widens with √time since the close"
                    : "Reference read at the clear",
            ],
            ["Chainlink feed", feed ? feed.base : bound ? "Read it from the causal reference" : "Not applicable"],
            ["Chainlink round", p.round ? `${p.round} (phase ${BigInt(p.round) >> 64n}, round ${BigInt(p.round) & 0xffff_ffff_ffff_ffffn})` : "Not applicable"],
            ["Receipt hash", p.receiptHash],
            ["Previous receipt", p.prevReceiptHash],
            ["Receipt chain", p.chainOk ? "Links to the previous receipt and recomputes" : "Does not recompute"],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k} className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
            <dt className="text-ink-3">{k}</dt>
            {/* hashes and addresses may break anywhere; words never do */}
            <dd className={`figures min-w-0 text-ink ${/^0x[0-9a-f]{20,}$/i.test(v) ? "break-all" : "break-words"}`}>{v}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="check-title" className="mt-14">
        <h2 id="check-title" className="text-display-s text-ink">
          Check it yourself
        </h2>
        <p className="mt-3 max-w-2xl text-ink-2">
          {causal ? (
            <>
              From the chain alone: the receipt hash recomputes, the round&apos;s observation time is the receipt&apos;s, the
              seal is the block&apos;s own time, the round before it was not after the oldest order&apos;s seal, and no order
              sealed in time was left out.
            </>
          ) : discovery ? (
            <>
              From the chain alone: the receipt hash recomputes, the round was the newest Chainlink had published, no
              observation came after the orders, the market&apos;s session was closed (or its feed silent) when it cleared,
              and the band is the one the regime gives.
            </>
          ) : (
            <>
              From the chain alone: the receipt hash recomputes from the auction&apos;s own event and links to the one before
              it. Under the older rule there is no observation to check against the seal: that is what the rule lacked.
            </>
          )}
        </p>
        <div className="mt-5 grid gap-4">
          <ReceiptCheck
            key={p.tx}
            rpcUrl={net.rpcUrl}
            tx={p.tx as Hex}
            tape={{ marketId: p.marketId, upTo: p.upTo, price: p.price, volume: p.volume, receiptHash: p.receiptHash, rule: p.rule }}
          />
          <Code
            lang="bash"
            title="the whole receipt, from the repository"
            code={`node apps/web/scripts/verify-receipt.mjs ${p.tx}`}
          />
          {bound && feed ? (
            <Code
              lang="bash"
              title="the round, from Chainlink's feed (startedAt is the observation time)"
              code={`cast call ${feed.base} "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" ${p.round} --rpc-url https://rpc.monad.xyz`}
            />
          ) : null}
          <Code
            lang="bash"
            title="the tape's record"
            code={`curl "${net.tapeUrl}/v1/markets/${p.marketId}/prints?before=${p.upTo + 1}&limit=1"`}
          />
        </div>
        <p className="mt-6 text-sm text-ink-3">
          How the rule works, and what it costs:{" "}
          <Link href="/fairness" className="text-ink underline decoration-line-strong underline-offset-4">
            the record
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
