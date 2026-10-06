"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { Lockup } from "@/components/brand/Lockup";
import { MARK_PARTS } from "@/components/brand/geometry";
import { TapeClient } from "@unison/sdk/tape";
import { useStore } from "@/lib/store/createStore";
import { toast } from "@/lib/ui/toast";
import { certificate } from "./certificateStore";

/** Interlaced sine bands along the paper's edge: the frame of a share certificate or a watch's papers. */
function guillocheFrame(w: number, h: number, inset: number, r: number, periods: number) {
  const perim: [number, number, number, number][] = []; // x, y, nx, ny
  const N = 1400;
  const iw = w - 2 * inset;
  const ih = h - 2 * inset;
  const straight = 2 * (iw - 2 * r) + 2 * (ih - 2 * r);
  const total = straight + 2 * Math.PI * r;
  for (let i = 0; i < N; i++) {
    let s = (i / N) * total;
    const segs: [number, (t: number) => [number, number, number, number]][] = [
      [iw - 2 * r, (t) => [inset + r + t, inset, 0, -1]],
      [
        (Math.PI * r) / 2,
        (t) => {
          const a = -Math.PI / 2 + t / r;
          return [inset + iw - r + r * Math.cos(a), inset + r + r * Math.sin(a), Math.cos(a), Math.sin(a)];
        },
      ],
      [ih - 2 * r, (t) => [inset + iw, inset + r + t, 1, 0]],
      [
        (Math.PI * r) / 2,
        (t) => {
          const a = t / r;
          return [inset + iw - r + r * Math.cos(a), inset + ih - r + r * Math.sin(a), Math.cos(a), Math.sin(a)];
        },
      ],
      [iw - 2 * r, (t) => [inset + iw - r - t, inset + ih, 0, 1]],
      [
        (Math.PI * r) / 2,
        (t) => {
          const a = Math.PI / 2 + t / r;
          return [inset + r + r * Math.cos(a), inset + ih - r + r * Math.sin(a), Math.cos(a), Math.sin(a)];
        },
      ],
      [ih - 2 * r, (t) => [inset, inset + ih - r - t, -1, 0]],
      [
        (Math.PI * r) / 2,
        (t) => {
          const a = Math.PI + t / r;
          return [inset + r + r * Math.cos(a), inset + r + r * Math.sin(a), Math.cos(a), Math.sin(a)];
        },
      ],
    ];
    for (const [len, at] of segs) {
      if (s <= len) {
        perim.push(at(s));
        break;
      }
      s -= len;
    }
  }
  // four waves, long enough in period that the interlace still reads on a 1x screen
  const waves = 4;
  const paths: string[] = [];
  for (let j = 0; j < waves; j++) {
    const phase = (j / waves) * Math.PI * 2;
    let d = "";
    perim.forEach(([x, y, nx, ny], i) => {
      const off = 6 * Math.sin((i / N) * Math.PI * 2 * periods + phase);
      d += `${i ? "L" : "M"}${(x + nx * off).toFixed(1)},${(y + ny * off).toFixed(1)}`;
    });
    paths.push(d + "Z");
  }
  return paths;
}

/** The venue's seal, engraved: the fork inside a ring of text, in champagne. It stands where a signature would. */
function Seal() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" role="img" aria-label="Sealed by Unison">
      <defs>
        <path id="seal-ring" d="M60,60 m-45,0 a45,45 0 1,1 90,0 a45,45 0 1,1 -90,0" />
      </defs>
      <g fill="none" stroke="var(--champagne)">
        <circle cx="60" cy="60" r="57" strokeWidth="1.1" />
        <circle cx="60" cy="60" r="54" strokeWidth="0.5" />
        <circle cx="60" cy="60" r="36" strokeWidth="0.6" />
      </g>
      <text className="dial-label" fill="var(--champagne)" style={{ fontSize: 8 }}>
        <textPath href="#seal-ring" textLength="270" lengthAdjust="spacing">
          UNISON · ONE PRICE FOR EVERYONE · EXECUTED ·
        </textPath>
      </text>
      <g transform="translate(40.8 40.8) scale(0.8)" fill="var(--ink)">
        {MARK_PARTS.map((p, i) => (
          <path key={i} d={p.d} />
        ))}
      </g>
    </svg>
  );
}

const NY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
/** "Oct 4, 2:03:22 PM ET": the auction's time on Wall Street's clock, the one the market keeps */
const cleared = (ts: number) => `${NY.format(new Date(ts))} ET`;

/**
 * The certificate of execution: the moment a fill becomes an object. One engraved guilloché band at the paper's
 * edge, the fill in Bodoni numerals, what it cost and how it compares with the limit, the block it cleared in and
 * the reference and band it cleared against, and the venue's seal. Landscape paper on wide screens, portrait on a
 * phone: the same band, drawn for each.
 */
export function CertificateDialog() {
  const data = useStore(certificate, (c) => c);
  const frame = useMemo(() => guillocheFrame(760, 556, 18, 3, 52), []);
  const portrait = useMemo(() => guillocheFrame(380, 700, 12, 3, 40), []);

  // Live fills: ask the tape to check this batch's receipt chain and recompute the fill from its uniform price.
  useEffect(() => {
    const l = data?.live;
    if (!data || !l || data.check) return;
    let alive = true;
    new TapeClient(l.tapeUrl)
      .receipt(l.marketId, l.account, l.slot)
      .then((r) => {
        if (!alive) return;
        const linked = r.verification.chainOk && r.prints.some((p) => p.upTo === data.block);
        const check = !linked
          ? "unverified"
          : r.verification.recomputed === true
            ? "recomputed"
            : r.verification.recomputed === false
              ? "unverified"
              : "linked";
        certificate.set({ ...data, check });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [data]);

  // The certificate says what the toast said, and more: one voice at a time.
  const opened = data ? `${data.ticker}:${data.orderId}:${data.block}` : null;
  useEffect(() => {
    if (opened) toast.dismiss();
  }, [opened]);

  const fmt = (t: number) => (data ? `$${(t * data.unit).toFixed(data.decimals)}` : "");
  const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const qty = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const improvement = data ? Math.abs(data.limitTick - data.tick) : 0;
  const notional = data ? data.qty * data.tick * data.unit : 0;
  const fee = data ? (notional * data.feeBps) / 10_000 : 0;
  // a buy reserves its size at its limit plus the fee cap; what the fill didn't use comes back
  const returned = data && data.side === "buy" ? data.qty * data.limitTick * data.unit * (1 + data.maxFeeBps / 10_000) - (notional + fee) : 0;
  const share = data && data.batchVolume > 0 ? (data.qty / data.batchVolume) * 100 : 0;
  // where the fill landed against the price its band was centred on, in basis points
  const vsRef = data && data.refTick > 0 ? ((data.tick - data.refTick) / data.refTick) * 10_000 : 0;

  return (
    <Dialog.Root open={!!data} onOpenChange={(o) => !o && certificate.set(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[3px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-[81] w-[min(94vw,760px)] -translate-x-1/2 -translate-y-1/2 outline-none transition-[opacity,scale] duration-[260ms] ease-[cubic-bezier(0.23,1,0.32,1)] data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-[180ms] data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0">
          {data ? (
            <>
              {/* the close sits on the scrim, clear of the paper and its frame */}
              <Dialog.Close
                aria-label="Close"
                className="press absolute -top-12 right-0 grid size-9 place-items-center rounded-full bg-raised text-ink-2 shadow-float hover-fine:text-ink"
              >
                <X size={16} strokeWidth={1.75} aria-hidden />
              </Dialog.Close>
              <div className="relative aspect-[380/700] w-full overflow-hidden rounded-[6px] bg-raised text-ink shadow-lg sm:aspect-[760/556]">
                <svg viewBox="0 0 380 700" className="absolute inset-0 h-full w-full sm:hidden" aria-hidden>
                  <g fill="none" stroke="var(--champagne)" strokeWidth="0.75" opacity="0.8">
                    {portrait.map((d, i) => (
                      <path key={i} d={d} />
                    ))}
                  </g>
                </svg>
                <svg viewBox="0 0 760 556" className="absolute inset-0 hidden h-full w-full sm:block" aria-hidden>
                  <g fill="none" stroke="var(--champagne)" strokeWidth="0.75" opacity="0.8">
                    {frame.map((d, i) => (
                      <path key={i} d={d} />
                    ))}
                  </g>
                </svg>
                <div className="absolute inset-x-[10%] top-[7%] bottom-[7%] flex flex-col sm:inset-x-[7%] sm:top-[8%] sm:bottom-[8.5%]">
                  <div className="flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <Lockup capHeight={11} />
                    <Dialog.Title className="dial-label text-ink-3">Certificate of execution</Dialog.Title>
                  </div>
                  <div className="mt-[3.5%]">
                    <p className="text-sm text-ink-3">{data.side === "buy" ? "Bought" : "Sold"}</p>
                    <p className="numerals mt-1 text-[clamp(1.6rem,5vw,2.8rem)] leading-none">
                      {qty(data.qty)} {data.ticker} <span className="text-ink-3">at</span> {fmt(data.tick)}
                    </p>
                    <Dialog.Description className="mt-3 text-[clamp(0.78rem,1.6vw,0.95rem)] text-ink-2">
                      The same price as {data.participants > 1 ? `all ${data.participants} orders that traded` : "every order that traded"} in
                      {" "}
                      {data.receipt ? "block" : "simulated block"} {data.block.toLocaleString("en-US")}.
                    </Dialog.Description>
                    {/* the two figures a trader reads first, larger than the record beneath them */}
                    <dl className="mt-[3%] flex gap-x-10 gap-y-2">
                      <div>
                        <dt className="text-xs text-ink-3">{data.side === "buy" ? "You paid" : "You received"}</dt>
                        <dd className="figures mt-0.5 text-[clamp(1rem,2vw,1.25rem)] font-medium text-ink">
                          {money(data.side === "buy" ? notional + fee : notional - fee)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ink-3">Price improvement</dt>
                        <dd className="figures mt-0.5 text-[clamp(1rem,2vw,1.25rem)] font-medium text-ink">
                          {improvement ? (
                            <>
                              {fmt(improvement)} per {data.ticker}{" "}
                              {Math.abs(data.qty - 1) > 1e-9 ? (
                                // a small fill's improvement can be under a cent: say so, not "$0.00"
                                <span className="text-ink-3">({improvement * data.unit * data.qty < 0.005 ? "under $0.01" : money(improvement * data.unit * data.qty)} in all)</span>
                              ) : null}
                            </>
                          ) : (
                            "None: at your limit"
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <dl className="mt-auto grid grid-cols-2 gap-x-5 gap-y-3 border-t border-line pt-4 text-[0.78rem] sm:grid-cols-4 sm:gap-x-5 sm:text-[clamp(0.7rem,1.1vw,0.8rem)]">
                    {[
                      [
                        "Order",
                        data.orderQty
                          ? `#${data.orderId} · ${qty(data.qty)} of ${qty(data.orderQty)}`
                          : `#${data.orderId}`,
                      ],
                      ["Your limit", `${data.side === "buy" ? "≤" : "≥"} ${fmt(data.limitTick)}`],
                      [data.closed ? "Last close" : "Reference", `${fmt(data.refTick)} · ${vsRef >= 0 ? "+" : "−"}${Math.abs(vsRef).toFixed(1)} bp`],
                      ["Auction", data.closed ? `Call, every ${data.discCadence} blocks` : data.causal ? "At Chainlink's next price" : "Every block"],
                      ["Notional", money(notional)],
                      ["Fee", `${money(fee)} · ${data.feeBps} bp`],
                      ...(data.side === "buy" ? [["Reserve returned", money(Math.max(0, returned))]] : []),
                      ["Auction volume", `${qty(data.batchVolume)} ${data.ticker}`],
                      ["Of auction volume", share >= 99.95 ? "All of it" : `${share.toFixed(1)}%`],
                      ["Band at this auction", `${fmt(data.bandLo)} – ${fmt(data.bandHi)}`],
                      ["Cleared", cleared(data.ts)],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-ink-3">{k}</dt>
                        <dd className="figures mt-0.5 text-ink">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-[3%] flex items-center justify-between gap-6">
                    <p className="max-w-[70%] text-[0.7rem] leading-relaxed text-ink-3 sm:max-w-[78%] sm:text-[clamp(0.62rem,1.2vw,0.75rem)]">
                      {data.receipt ? (
                        <>
                          Receipt{" "}
                          <span className="font-mono">
                            {data.receipt.slice(0, 10)}…{data.receipt.slice(-8)}
                          </span>
                          {data.check === "recomputed"
                            ? ". Linked in the venue's receipt chain; your fill recomputes from the batch price."
                            : data.check === "linked"
                              ? ". Linked in the venue's receipt chain."
                              : data.check === "unverified"
                                ? ". On-chain; the tape could not verify it."
                                : data.live
                                  ? ". Verifying…"
                                  : "."}
                          {data.live ? (
                            <>
                              {" "}
                              <Link href={data.live.page} className="text-ink underline decoration-line-strong underline-offset-2 hover-fine:decoration-ink">
                                {data.causal ? "See the three times" : "Open the receipt"}
                              </Link>
                            </>
                          ) : null}
                        </>
                      ) : (
                        "Simulation: cleared by the real clearing engine in your browser."
                      )}
                    </p>
                    <div className="w-[20%] shrink-0 sm:w-[13%]">
                      <Seal />
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
