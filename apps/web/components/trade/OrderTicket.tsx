"use client";

import { buyLock } from "@unison/engine";
import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BEAT_MS } from "@/lib/motion/tokens";
import { toast } from "@/lib/ui/toast";
import { useStore } from "@/lib/store/createStore";
import { useMarket, useVenue, useVenueAccount } from "@/lib/venue";
import { identity } from "@/lib/venue/identity";
import { watchOrder } from "@/lib/venue/orderWatch";
import { preloadSignIn, SignInSheet } from "@/components/app/SignInSheet";
import { certificate, certificateFor } from "./certificateStore";
import { priceFormat } from "@/lib/content/markets";
import { clearBatch } from "@/lib/sim/batch";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The order ticket. The limit is a price you set: it starts at the last trade and stays where you put it. Every
 * number under it is exact: the lock is the contract's `buyLock` (notional at your limit plus the market's fee cap),
 * and both indicatives run the clearing engine on the batch now forming, once as it stands and once with your order.
 */
export function OrderTicket({
  ticker,
  defaultSide = "buy",
  onPlaced,
}: {
  ticker: string;
  defaultSide?: "buy" | "sell";
  onPlaced?: () => void;
}) {
  const {
    market,
    value: m,
    spec,
    live,
  } = useMarket(ticker, (s) => ({
    refTick: s.refTick,
    lo: s.lo,
    hi: s.hi,
    book: s.book,
    vault: s.vault,
    regime: s.regime.name,
    last: s.last?.tick ?? null,
    block: s.block,
  }));
  const free = useVenueAccount((a) => ({ quote: a.quote, base: a.base[ticker] ?? 0 }));
  const v = useVenue();
  const signedIn = !!useStore(identity, (x) => x);
  const needsSignIn = live && !signedIn;
  const [signInOpen, setSignInOpen] = useState(false);
  const { unit, decimals, fmt } = priceFormat(spec);
  const discovery = m.regime === "DISCOVERY";
  const refLabel = discovery ? "Last close" : "Reference";

  const [side, setSide] = useState<"buy" | "sell">(defaultSide);
  // The limit, in ticks: null until the market is known, then the last trade, then wherever you put it.
  const [limitTick, setLimitTick] = useState<number | null>(null);
  const [limitText, setLimitText] = useState<string | null>(null);
  const anchor = m.last ?? m.refTick;
  if (limitTick === null && m.block > 0 && anchor > 0) setLimitTick(anchor);
  const limit = limitTick ?? anchor;
  const setPrice = (tick: number) => {
    setLimitTick(Math.max(1, tick));
    setLimitText(null);
  };
  const [qtyText, setQtyText] = useState("1");
  const [ioc, setIoc] = useState(false);
  const qty = Math.max(0, Number(qtyText) || 0);

  const lock = useMemo(() => {
    if (side === "sell") return qty;
    const l = buyLock(
      BigInt(Math.round(qty * 1e6)),
      BigInt(Math.round(limit * unit * 1e6)),
      BigInt(spec.maxFeeBps),
      1_000_000n,
    );
    return Number(l) / 1e6;
  }, [side, qty, limit, unit, spec.maxFeeBps]);
  const affordable = side === "buy" ? lock <= free.quote : qty <= free.base;
  const inBand = limit >= m.lo && limit <= m.hi;

  // The batch now forming, cleared as it stands (the book and the vault) and again with your order in it.
  const band = useMemo(() => ({ lo: m.lo, hi: m.hi, refTick: m.refTick }), [m.lo, m.hi, m.refTick]);
  const alone = useMemo(() => {
    const out = clearBatch([...m.book, ...m.vault], band);
    return out.traded ? out.tick : null;
  }, [m.book, m.vault, band]);
  const withYou = useMemo(() => {
    if (qty <= 0) return null;
    const out = clearBatch([...m.book, ...m.vault, { id: 0, side, tick: limit, qty }], band);
    return out.traded ? { tick: out.tick, filled: out.fills.get(0) ?? 0 } : null;
  }, [m.book, m.vault, band, side, limit, qty]);
  const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  // What your order would do in that auction, in words: in full, in part (and why), or not at all.
  const rests = ioc ? "is cancelled" : "rests";
  const fillNote = !withYou
    ? "Buyers and sellers don't meet inside the band yet."
    : withYou.filled >= qty - 0.004
      ? `All ${n(qty)} ${ticker} would fill${alone !== null && alone !== withYou.tick ? `; your order moves the price from ${fmt(alone)}` : ""}.`
      : withYou.filled > 0
        ? `${n(withYou.filled)} of ${n(qty)} ${ticker} would fill, pro rata at the clearing price; ${n(qty - withYou.filled)} ${rests}.`
        : `None would fill: it clears ${side === "buy" ? "above" : "below"} your limit. Your order ${rests}.`;
  // What it would cost (or bring) if the auction ran now: the fill at the clearing price, plus or minus the fee.
  const estimate =
    withYou && withYou.filled > 0
      ? withYou.filled * withYou.tick * unit * (side === "buy" ? 1 + spec.feeBps / 10_000 : 1 - spec.feeBps / 10_000)
      : null;

  const maxQty =
    side === "buy" ? Math.floor((free.quote / (limit * unit * (1 + spec.maxFeeBps / 10_000))) * 100) / 100 : free.base;
  // Fat-finger guard: a limit far from where it trades, or most of what you have, takes a second, explicit tap.
  const deviation = anchor > 0 ? (limit - anchor) / anchor : 0;
  const share = side === "buy" ? (free.quote > 0 ? lock / free.quote : 0) : free.base > 0 ? qty / free.base : 0;
  const caution =
    Math.abs(deviation) > 0.01
      ? `${(Math.abs(deviation) * 100).toFixed(1)}% ${deviation > 0 ? "above" : "below"} the last trade`
      : share > 0.5
        ? `${Math.round(share * 100)}% of your ${side === "buy" ? "AUSD" : ticker}`
        : null;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const submit = async () => {
    if (needsSignIn) {
      setSignInOpen(true);
      return;
    }
    if (qty <= 0 || !affordable) return;
    if (caution && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    const r = await market.place(side, limit, Math.round(qty * 100) / 100, ioc);
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    // when it clears depends on the regime: every block in session, one call auction every few blocks while closed
    const when = discovery
      ? `the next auction, within about ${(spec.regime.discCadence * BEAT_MS) / 1000} s`
      : "about 0.3 s";
    const toastId = toast.loading(
      `${side === "buy" ? "Buy" : "Sell"} ${qty} ${ticker} in the next ${discovery ? "auction" : "batch"}`,
      {
        description: live
          ? `Limit ${fmt(limit)} · signed and relayed, no gas`
          : `Limit ${fmt(limit)} · clears in ${when}`,
      },
    );
    const net = live ? v.net : null;
    watchOrder({
      id: r.id,
      ticker,
      side,
      limit,
      ioc,
      block: market.store.get().block,
      toastId,
      fmt,
      onCertificate: (fill) => certificate.set(certificateFor(fill, spec, net)),
    });
    onPlaced?.();
  };

  // Prices worth one tap, each a fixed price: the last trade, the band's centre (the reference, or the last close),
  // and where the auction would clear now.
  const chips: [string, number][] = [];
  for (const [label, t] of [
    ["Last", m.last],
    [discovery ? "Close" : "Ref", m.refTick],
    ["Cross", alone],
  ] as [string, number | null][]) {
    if (t !== null && t > 0 && !chips.some(([, x]) => x === t)) chips.push([label, t]);
  }
  const text = limitText ?? (limit * unit).toFixed(decimals);

  return (
    <section
      aria-label="Order ticket"
      className="rounded-[var(--radius-xl)] bg-raised shadow-panel [scrollbar-width:thin] lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto"
    >
      <div className="p-4 pb-6 sm:p-5 sm:pb-6">
        <div role="radiogroup" aria-label="Side" className="grid grid-cols-2 rounded-full bg-sunken p-1">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              onClick={() => setSide(s)}
              className={`press rounded-full py-2.5 text-sm font-semibold capitalize transition-colors duration-150 ${
                side === s
                  ? s === "buy"
                    ? "bg-buy-fill text-bg shadow-sm"
                    : "bg-sell-fill text-bg shadow-sm"
                  : "text-ink-2 hover-fine:text-ink"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <label className="mt-3.5 block text-xs font-medium text-ink-3" htmlFor="limit">
          Limit price, {side === "buy" ? "the most you'll pay" : "the least you'll take"}
        </label>
        <div className="mt-2 flex items-center rounded-2xl bg-sunken p-1 focus-within:outline-2 focus-within:outline-focus">
          <button
            type="button"
            aria-label="One tick lower"
            onClick={() => setPrice(limit - 1)}
            className="press grid size-10 place-items-center rounded-xl text-ink-2 hover-fine:bg-bg"
          >
            <Minus size={15} strokeWidth={1.75} aria-hidden />
          </button>
          <div className="flex flex-1 items-baseline justify-center text-lg font-semibold text-ink">
            <span aria-hidden>$</span>
            <input
              id="limit"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => {
                const t = e.target.value.replace(/[^\d.]/g, "");
                setLimitText(t);
                const p = Number(t);
                if (t && p > 0) setLimitTick(Math.max(1, Math.round(p / unit)));
              }}
              onBlur={() => setLimitText(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setLimitText(null);
              }}
              style={{ width: `${Math.max(3, text.length) + 0.3}ch` }}
              className="figures bg-transparent text-left outline-none"
              aria-label="Limit price in dollars"
            />
          </div>
          <button
            type="button"
            aria-label="One tick higher"
            onClick={() => setPrice(limit + 1)}
            className="press grid size-10 place-items-center rounded-xl text-ink-2 hover-fine:bg-bg"
          >
            <Plus size={15} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map(([label, t]) => (
            <button
              key={label}
              type="button"
              onClick={() => setPrice(t)}
              className={`press tap figures rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${limit === t ? "bg-raised text-ink shadow-sm" : "bg-sunken text-ink-2 hover-fine:text-ink"}`}
            >
              {label} {fmt(t)}
            </button>
          ))}
        </div>

        {/* Band gauge: where your limit sits in this auction's band, which is centred on the reference (or the last close) */}
        <div className="mt-3.5" aria-hidden>
          <div className="relative h-1.5 rounded-full bg-sunken">
            <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-ink-3" style={{ left: "50%" }} />
            <div
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-raised"
              style={{
                left: `${Math.min(100, Math.max(0, ((limit - m.lo) / Math.max(1, m.hi - m.lo)) * 100))}%`,
                background: "var(--ball-3)",
              }}
            />
          </div>
          <div className="figures mt-1.5 flex justify-between text-[11px] text-ink-3">
            <span>{fmt(m.lo)}</span>
            <span>band around the {refLabel.toLowerCase()}</span>
            <span>{fmt(m.hi)}</span>
          </div>
        </div>
        {!inBand ? (
          <p className="mt-2 text-xs text-halt">
            Outside this auction&apos;s band. It rests until the band reaches it.
          </p>
        ) : null}

        <label className="mt-3.5 flex justify-between gap-3 text-xs font-medium text-ink-3" htmlFor="qty">
          <span>Quantity ({ticker})</span>
          <span className="figures font-normal">
            {side === "buy" ? `${n(free.quote)} AUSD free` : `${free.base.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${ticker} free`}
          </span>
        </label>
        <input
          id="qty"
          inputMode="decimal"
          autoComplete="off"
          value={qtyText}
          onChange={(e) => setQtyText(e.target.value.replace(/[^\d.]/g, ""))}
          className="figures mt-2 w-full rounded-2xl bg-sunken px-4 py-2.5 text-center text-lg font-semibold text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus"
          aria-describedby="qty-help"
        />
        <div className="mt-2 flex gap-1.5">
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setQtyText(String(Math.floor(maxQty * f * 100) / 100))}
              className="press tap flex-1 rounded-full bg-sunken py-1 text-xs font-medium text-ink-2 hover-fine:text-ink"
            >
              {f === 1 ? "Max" : `${f * 100}%`}
            </button>
          ))}
        </div>

        {/* How long the order lives, said in words, with what happens to what doesn't fill. */}
        <p className="mt-3.5 text-xs font-medium text-ink-3" id="duration-label">
          How long
        </p>
        <div
          role="radiogroup"
          aria-labelledby="duration-label"
          className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-sunken p-1"
        >
          {(
            [
              [false, "Until cancelled"],
              [true, discovery ? "Next auction only" : "This batch only"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={ioc === val}
              onClick={() => setIoc(val)}
              className={`press min-h-9 rounded-full text-sm font-medium transition-colors duration-150 ${ioc === val ? "bg-raised text-ink shadow-sm" : "text-ink-2 hover-fine:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          {ioc
            ? "What doesn't fill then is cancelled, and its funds come back."
            : discovery
              ? "Joins every auction until it fills, the reopening included."
              : "Joins every batch until it fills or you cancel."}
        </p>

        <dl id="qty-help" className="mt-3.5 space-y-2 border-t border-line pt-3.5 text-sm">
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
            <dt className="text-ink-3">Fills now at</dt>
            <dd className="figures text-ink">{withYou ? fmt(withYou.tick) : "No cross yet"}</dd>
            <dd className="figures basis-full text-xs leading-relaxed text-ink-3">{fillNote}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
            <dt className="text-ink-3">{side === "buy" ? "Estimated cost" : "Estimated proceeds"}</dt>
            <dd className="figures font-semibold text-ink">{estimate !== null ? money(estimate) : "None yet"}</dd>
            <dd className="figures basis-full text-xs leading-relaxed text-ink-3">
              {estimate !== null && withYou ? `For the ${n(withYou.filled)} ${ticker} that would fill, ${side === "buy" ? "with" : "less"} the ${spec.feeBps} bp fee.` : "Nothing would fill now."}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
            <dt className="text-ink-3">Reserved</dt>
            <dd className="figures text-ink">{side === "buy" ? money(lock) : `${n(lock)} ${ticker}`}</dd>
            <dd className="basis-full text-xs leading-relaxed text-ink-3">
              {side === "buy"
                ? `Until it fills: all ${n(qty)} at your limit, plus ${spec.maxFeeBps} bp, the most the fee can be. The rest comes back.`
                : `You receive the auction's price, less the ${spec.feeBps} bp fee.`}
            </dd>
          </div>
        </dl>
      </div>

      {/* The action stays in reach while the ticket scrolls. */}
      <div className="sticky bottom-0 bg-raised px-4 pt-4 pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-gradient-to-t before:from-raised before:to-transparent sm:px-5 sm:pb-5">
        <button
          type="button"
          onClick={submit}
          onPointerEnter={needsSignIn ? preloadSignIn : undefined}
          onFocus={needsSignIn ? preloadSignIn : undefined}
          disabled={!needsSignIn && (qty <= 0 || !affordable)}
          className={`press w-full rounded-full py-3.5 text-[15px] font-semibold text-bg shadow-md transition-opacity disabled:opacity-40 ${side === "buy" ? "bg-buy-fill" : "bg-sell-fill"}`}
        >
          {needsSignIn
            ? "Sign in to trade"
            : !affordable
              ? side === "buy"
                ? "Not enough AUSD"
                : `Not enough ${ticker}`
              : armed && caution
                ? `Confirm: ${caution}`
                : `${side === "buy" ? "Buy" : "Sell"} ${qty || ""} ${ticker} at ${side === "buy" ? "≤" : "≥"} ${fmt(limit)}`}
        </button>
        <p className="mt-2.5 text-center text-xs text-ink-3">
          Fee {spec.feeBps} bp. Everyone in the auction gets the same price.
        </p>
      </div>
      <SignInSheet open={signInOpen} onOpenChange={setSignInOpen} />
    </section>
  );
}
