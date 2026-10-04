"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Lockup } from "@/components/brand/Lockup";
import { MARK_PARTS } from "@/components/brand/geometry";
import { priceFormat, type MarketSpec } from "@/lib/content/markets";
import type { MyFill } from "@/lib/demo/engine";
import { TapeClient } from "@unison/sdk";
import { createStore, useStore } from "@/lib/store/createStore";
import type { NetConfig } from "@/lib/venue/config";
import { identity } from "@/lib/venue/identity";

/**
 * The certificate of execution: the moment a fill becomes an object. An engraved guilloché frame (interlaced
 * waves traced along the card's perimeter, banknote-style), the fill in Bodoni numerals, the batch it cleared in,
 * the reference and band it cleared against, and a signature that writes itself once.
 */
export interface CertificateData extends MyFill {
  ticker: string;
  name: string;
  unit: number;
  decimals: number;
  /** live fills: where the tape can check the receipt */
  live?: { tapeUrl: string; marketId: number; account: string; slot: number; explorer?: string };
  /**
   * The tape's check (live): "recomputed" when the receipt chain links through this batch and the fill recomputes
   * from its uniform price; "linked" when only the chain could be checked; "unverified" when the check failed.
   */
  check?: "recomputed" | "linked" | "unverified";
}

export const certificate = createStore<CertificateData | null>(null);

/** A fill → its certificate. Live fills (net given, signed in) carry where to verify their receipt. */
export function certificateFor(fill: MyFill, spec: MarketSpec, net: NetConfig | null): CertificateData {
  const { unit, decimals } = priceFormat(spec);
  const account = identity.get()?.account;
  const marketId = net?.deployment.markets[spec.symbol]?.id;
  return {
    ...fill,
    ticker: spec.ticker,
    name: spec.name,
    unit,
    decimals,
    ...(net && account && marketId !== undefined ? { live: { tapeUrl: net.tapeUrl, marketId, account, slot: fill.orderId, explorer: net.explorer } } : {}),
  };
}

/** Interlaced sine bands along a rounded rectangle: the frame of a share certificate or a watch's papers. */
function guillocheFrame(w: number, h: number, inset: number, r: number) {
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
      [(Math.PI * r) / 2, (t) => { const a = -Math.PI / 2 + t / r; return [inset + iw - r + r * Math.cos(a), inset + r + r * Math.sin(a), Math.cos(a), Math.sin(a)]; }],
      [ih - 2 * r, (t) => [inset + iw, inset + r + t, 1, 0]],
      [(Math.PI * r) / 2, (t) => { const a = t / r; return [inset + iw - r + r * Math.cos(a), inset + ih - r + r * Math.sin(a), Math.cos(a), Math.sin(a)]; }],
      [iw - 2 * r, (t) => [inset + iw - r - t, inset + ih, 0, 1]],
      [(Math.PI * r) / 2, (t) => { const a = Math.PI / 2 + t / r; return [inset + r + r * Math.cos(a), inset + ih - r + r * Math.sin(a), Math.cos(a), Math.sin(a)]; }],
      [ih - 2 * r, (t) => [inset, inset + ih - r - t, -1, 0]],
      [(Math.PI * r) / 2, (t) => { const a = Math.PI + t / r; return [inset + r + r * Math.cos(a), inset + r + r * Math.sin(a), Math.cos(a), Math.sin(a)]; }],
    ];
    for (const [len, at] of segs) {
      if (s <= len) {
        perim.push(at(s));
        break;
      }
      s -= len;
    }
  }
  const waves = 7;
  const paths: string[] = [];
  for (let j = 0; j < waves; j++) {
    const phase = (j / waves) * Math.PI * 2;
    let d = "";
    perim.forEach(([x, y, nx, ny], i) => {
      const off = 7 * Math.sin((i / N) * Math.PI * 2 * 70 + phase);
      d += `${i ? "L" : "M"}${(x + nx * off).toFixed(1)},${(y + ny * off).toFixed(1)}`;
    });
    paths.push(d + "Z");
  }
  return paths;
}

export function CertificateDialog() {
  const data = useStore(certificate, (c) => c);
  const [sig, setSig] = useState<string | null>(null);
  const frame = useMemo(() => guillocheFrame(760, 560, 20, 26), []);

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
        const check = !linked ? "unverified" : r.verification.recomputed === true ? "recomputed" : r.verification.recomputed === false ? "unverified" : "linked";
        certificate.set({ ...data, check });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [data]);

  // The signature writes itself once each time a certificate opens (not again when its check comes back).
  const opened = data ? `${data.ticker}:${data.orderId}:${data.block}` : null;
  useEffect(() => {
    if (!opened) return;
    let live = true;
    fetch("/brand/signature.svg")
      .then((r) => r.text())
      .then((t) => live && setSig(t))
      .catch(() => live && setSig(null));
    return () => {
      live = false;
      setSig(null);
    };
  }, [opened]);

  const fmt = (t: number) => (data ? `$${(t * data.unit).toFixed(data.decimals)}` : "");
  const improvement = data ? Math.abs(data.limitTick - data.tick) : 0;

  return (
    <Dialog.Root open={!!data} onOpenChange={(o) => !o && certificate.set(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[3px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-[81] w-[min(94vw,760px)] -translate-x-1/2 -translate-y-1/2 outline-none transition-[opacity,scale] duration-[260ms] ease-[cubic-bezier(0.23,1,0.32,1)] data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-[180ms] data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0">
          {data ? (
            <div className="relative aspect-[760/560] w-full overflow-hidden rounded-[34px] bg-raised text-ink shadow-lg">
              <svg viewBox="0 0 760 560" className="absolute inset-0 h-full w-full" aria-hidden>
                <g fill="none" stroke="var(--champagne)" strokeWidth="0.55" opacity="0.7">
                  {frame.map((d, i) => (
                    <path key={i} d={d} />
                  ))}
                </g>
                <rect x="40" y="40" width="680" height="480" rx="14" fill="none" stroke="var(--line-strong)" />
                {/* Security watermark: the mark, engraved faintly behind the figures */}
                <g transform="translate(470 120) scale(6.2)" fill="var(--ink)" opacity="0.035">
                  {MARK_PARTS.map((p, i) => (
                    <path key={i} d={p.d} />
                  ))}
                </g>
              </svg>
              <div className="absolute inset-x-[7.5%] top-[9.5%] bottom-[7.5%] flex flex-col">
                <div className="flex items-center justify-between">
                  <Lockup capHeight={11} />
                  <Dialog.Title className="dial-label text-ink-3">Certificate of execution</Dialog.Title>
                </div>
                <div className="mt-[5%]">
                  <p className="text-sm text-ink-3">{data.side === "buy" ? "Bought" : "Sold"}</p>
                  <p className="numerals mt-1 text-[clamp(1.75rem,5.4vw,3.25rem)] leading-none">
                    {data.qty.toFixed(2)} {data.ticker} <span className="text-ink-3">at</span> {fmt(data.tick)}
                  </p>
                  <Dialog.Description className="mt-3 text-[clamp(0.8rem,1.6vw,0.95rem)] text-ink-2">
                    The same price as every order in batch {data.block.toLocaleString("en-US")}. {data.name}, quoted in AUSD.
                  </Dialog.Description>
                </div>
                <dl className="mt-auto grid grid-cols-3 gap-x-6 gap-y-3 text-[clamp(0.72rem,1.4vw,0.85rem)]">
                  {[
                    ["Batch", data.block.toLocaleString("en-US")],
                    ["Cleared", new Date(data.ts).toISOString().replace("T", " ").slice(0, 19) + " UTC"],
                    data.participants > 0 ? ["Orders in batch", String(data.participants)] : ["Batch volume", `${data.batchVolume.toFixed(2)} ${data.ticker}`],
                    ["Reference", fmt(data.refTick)],
                    ["Band", `${fmt(data.bandLo)} – ${fmt(data.bandHi)}`],
                    ["Better than your limit by", improvement ? fmt(improvement) : "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-ink-3">{k}</dt>
                      <dd className="tnum mt-0.5 text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-[4%] flex items-end justify-between gap-6 border-t border-line pt-3">
                  <p className="max-w-[55%] text-[clamp(0.65rem,1.2vw,0.75rem)] leading-relaxed text-ink-3">
                    {data.receipt ? (
                      <>
                        Receipt <span className="font-mono">{data.receipt.slice(0, 10)}…{data.receipt.slice(-8)}</span>
                        {data.check === "recomputed"
                          ? ". Linked in the venue's receipt chain; your fill recomputes from the batch price."
                          : data.check === "linked"
                            ? ". Linked in the venue's receipt chain."
                            : data.check === "unverified"
                              ? ". On-chain; the tape could not verify it."
                              : data.live
                                ? ". Verifying…"
                                : "."}
                      </>
                    ) : (
                      "Simulation: cleared by the real clearing engine in your browser. Live fills carry an on-chain receipt."
                    )}
                  </p>
                  <div className="w-[34%] text-ink" aria-label="Signed: Unison" role="img" dangerouslySetInnerHTML={sig ? { __html: sig.replace(/width="[^"]+" height="[^"]+"/, 'style="width:100%;height:auto;display:block"') } : undefined} />
                </div>
              </div>
              <Dialog.Close aria-label="Close" className="press absolute top-4 right-4 grid size-9 place-items-center rounded-full text-ink-3 hover-fine:bg-ink/[0.06] hover-fine:text-ink">
                <X size={16} strokeWidth={1.75} aria-hidden />
              </Dialog.Close>
            </div>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
