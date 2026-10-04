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
import { simulatedVault } from "./charts";

/**
 * The order ticket. Every number on it is exact: the lock is the contract's `buyLock` (notional at your limit plus
 * the market's fee cap), and the indicative fill runs the clearing engine on the live book with your order added.
 */
export function OrderTicket({ ticker, defaultSide = "buy", onPlaced }: { ticker: string; defaultSide?: "buy" | "sell"; onPlaced?: () => void }) {
  const { market, value: m, spec, live } = useMarket(ticker, (s) => ({ refTick: s.refTick, lo: s.lo, hi: s.hi, book: s.book, regime: s.regime.name }));
  const free = useVenueAccount((a) => ({ quote: a.quote, base: a.base[ticker] ?? 0 }));
  const v = useVenue();
  const signedIn = !!useStore(identity, (x) => x);
  const needsSignIn = live && !signedIn;
  const [signInOpen, setSignInOpen] = useState(false);
  const { unit, fmt } = priceFormat(spec);

  const [side, setSide] = useState<"buy" | "sell">(defaultSide);
  const [offsetTicks, setOffsetTicks] = useState(2); // limit = reference + offset (buys) or − offset (sells)
  const [qtyText, setQtyText] = useState("1");
  const [ioc, setIoc] = useState(false);
  const qty = Math.max(0, Number(qtyText) || 0);
  const limit = side === "buy" ? m.refTick + offsetTicks : m.refTick - offsetTicks;

  const lock = useMemo(() => {
    if (side === "sell") return qty;
    const l = buyLock(BigInt(Math.round(qty * 1e6)), BigInt(Math.round(limit * unit * 1e6)), BigInt(spec.maxFeeBps), 1_000_000n);
    return Number(l) / 1e6;
  }, [side, qty, limit, unit, spec.maxFeeBps]);
  const affordable = side === "buy" ? lock <= free.quote : qty <= free.base;
  const inBand = limit >= m.lo && limit <= m.hi;

  // What would happen if the batch cleared now: the engine on the live book, the vault, and you.
  const indicative = useMemo(() => {
    if (qty <= 0) return null;
    const vault = live ? [] : simulatedVault(m.refTick);
    const out = clearBatch([...m.book, ...vault, { id: 0, side, tick: limit, qty }], { lo: m.lo, hi: m.hi, refTick: m.refTick });
    return out.traded ? { tick: out.tick, filled: out.fills.get(0) ?? 0 } : null;
  }, [m.book, m.refTick, m.lo, m.hi, side, limit, qty, live]);

  const maxQty = side === "buy" ? Math.floor((free.quote / (limit * unit * 1.001)) * 100) / 100 : free.base;
  // Fat-finger guard: a limit far from the reference, or most of what you have, takes a second, explicit tap.
  const deviation = m.refTick > 0 ? (limit - m.refTick) / m.refTick : 0;
  const share = side === "buy" ? (free.quote > 0 ? lock / free.quote : 0) : free.base > 0 ? qty / free.base : 0;
  const caution = Math.abs(deviation) > 0.01 ? `${(Math.abs(deviation) * 100).toFixed(1)}% ${deviation > 0 ? "above" : "below"} the reference` : share > 0.5 ? `${Math.round(share * 100)}% of your ${side === "buy" ? "AUSD" : ticker}` : null;
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
    const when = m.regime === "DISCOVERY" ? `the next auction, within about ${(spec.regime.discCadence * BEAT_MS) / 1000} s` : "about 0.3 s";
    const toastId = toast.loading(`${side === "buy" ? "Buy" : "Sell"} ${qty} ${ticker} in the next ${m.regime === "DISCOVERY" ? "auction" : "batch"}`, {
      description: live ? `Limit ${fmt(limit)} · signed and relayed, no gas` : `Limit ${fmt(limit)} · clears in ${when}`,
    });
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

  const chips = side === "buy" ? [0, 2, 10, 50] : [0, 2, 10, 50];

  return (
    <section aria-label="Order ticket" className="rounded-[var(--radius-xl)] bg-raised p-4 shadow-md sm:p-5">
      <div role="radiogroup" aria-label="Side" className="grid grid-cols-2 rounded-full bg-sunken p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={side === s}
            onClick={() => setSide(s)}
            className={`press rounded-full py-2.5 text-sm font-semibold capitalize transition-colors duration-150 ${
              side === s ? (s === "buy" ? "bg-buy-fill text-bg shadow-sm" : "bg-sell-fill text-bg shadow-sm") : "text-ink-2 hover-fine:text-ink"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <label className="mt-5 block text-xs font-medium text-ink-3" htmlFor="limit">
        Limit price
      </label>
      <div className="mt-2 flex items-center rounded-2xl bg-sunken p-1">
        <button type="button" aria-label="One tick lower" onClick={() => setOffsetTicks((o) => (side === "buy" ? o - 1 : o + 1))} className="press grid size-10 place-items-center rounded-xl text-ink-2 hover-fine:bg-bg">
          <Minus size={15} strokeWidth={1.75} aria-hidden />
        </button>
        <output id="limit" className="tnum flex-1 text-center text-lg font-semibold text-ink">
          {fmt(limit)}
        </output>
        <button type="button" aria-label="One tick higher" onClick={() => setOffsetTicks((o) => (side === "buy" ? o + 1 : o - 1))} className="press grid size-10 place-items-center rounded-xl text-ink-2 hover-fine:bg-bg">
          <Plus size={15} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setOffsetTicks(c)}
            className={`press tap rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${offsetTicks === c ? "bg-ink text-bg" : "bg-sunken text-ink-2 hover-fine:text-ink"}`}
          >
            {c === 0 ? "Reference" : `${side === "buy" ? "+" : "−"}${fmt(c).replace("$", "$")}`}
          </button>
        ))}
      </div>

      {/* Band gauge: where your limit sits in this batch's band */}
      <div className="mt-4" aria-hidden>
        <div className="relative h-1.5 rounded-full bg-sunken">
          <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-ink-3" style={{ left: "50%" }} />
          <div
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-raised"
            style={{ left: `${Math.min(100, Math.max(0, ((limit - m.lo) / Math.max(1, m.hi - m.lo)) * 100))}%`, background: "var(--ball-3)" }}
          />
        </div>
        <div className="tnum mt-1.5 flex justify-between text-[11px] text-ink-3">
          <span>{fmt(m.lo)}</span>
          <span>band</span>
          <span>{fmt(m.hi)}</span>
        </div>
      </div>
      {!inBand ? <p className="mt-2 text-xs text-halt">Outside this batch&apos;s band. It rests until the band reaches it.</p> : null}

      <label className="mt-5 block text-xs font-medium text-ink-3" htmlFor="qty">
        Quantity ({ticker})
      </label>
      <input
        id="qty"
        inputMode="decimal"
        value={qtyText}
        onChange={(e) => setQtyText(e.target.value.replace(/[^\d.]/g, ""))}
        className="tnum mt-2 w-full rounded-2xl bg-sunken px-4 py-3 text-lg font-semibold text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus"
        aria-describedby="qty-help"
      />
      <div className="mt-2 flex gap-1.5">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <button key={f} type="button" onClick={() => setQtyText(String(Math.floor(maxQty * f * 100) / 100))} className="press tap flex-1 rounded-full bg-sunken py-1 text-xs font-medium text-ink-2 hover-fine:text-ink">
            {f === 1 ? "Max" : `${f * 100}%`}
          </button>
        ))}
      </div>

      {/* How long the order lives, said in words, with what happens to what doesn't fill. */}
      <p className="mt-5 text-xs font-medium text-ink-3" id="duration-label">
        How long
      </p>
      <div role="radiogroup" aria-labelledby="duration-label" className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-sunken p-1">
        {([
          [false, "Until cancelled"],
          [true, "This batch only"],
        ] as const).map(([v, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={ioc === v}
            onClick={() => setIoc(v)}
            className={`press min-h-9 rounded-full text-sm font-medium transition-colors duration-150 ${ioc === v ? "bg-ink text-bg shadow-sm" : "text-ink-2 hover-fine:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-3">
        {ioc
          ? "Whatever doesn't fill in the next batch is cancelled, and its funds come back."
          : m.regime === "DISCOVERY"
            ? "It joins every batch until it fills or you cancel. Wall Street is closed: it can also fill when trading reopens, at a different price."
            : "It joins every batch until it fills or you cancel."}
      </p>

      <dl id="qty-help" className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
        <div className="flex flex-wrap justify-between gap-y-1">
          <dt className="text-ink-3">{side === "buy" ? "You lock at most" : "You lock"}</dt>
          <dd className="tnum text-ink">{side === "buy" ? `$${lock.toFixed(2)}` : `${lock} ${ticker}`}</dd>
          {side === "buy" ? (
            <dd className="basis-full text-xs leading-relaxed text-ink-3">
              Your limit plus the {spec.maxFeeBps} bp fee cap. You pay the batch&apos;s price and a {spec.feeBps} bp fee; the rest comes back.
            </dd>
          ) : null}
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-3">If the batch cleared now</dt>
          <dd className="tnum text-ink">{indicative ? `${indicative.filled.toFixed(2)} at ${fmt(indicative.tick)}` : "No cross yet"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-3">Available</dt>
          <dd className="tnum text-ink-2">{side === "buy" ? `$${free.quote.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `${free.base} ${ticker}`}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={submit}
        onPointerEnter={needsSignIn ? preloadSignIn : undefined}
        onFocus={needsSignIn ? preloadSignIn : undefined}
        disabled={!needsSignIn && (qty <= 0 || !affordable)}
        className={`press mt-5 w-full rounded-full py-3.5 text-[15px] font-semibold text-bg shadow-md transition-opacity disabled:opacity-40 ${side === "buy" ? "bg-buy-fill" : "bg-sell-fill"}`}
      >
        {needsSignIn
          ? "Sign in to trade"
          : !affordable
            ? side === "buy"
              ? "Not enough AUSD"
              : `Not enough ${ticker}`
            : armed && caution
              ? `Confirm: ${caution}`
              : `${side === "buy" ? "Buy" : "Sell"} ${qty || ""} ${ticker}`}
      </button>
      <SignInSheet open={signInOpen} onOpenChange={setSignInOpen} />
      <p className="mt-3 text-center text-xs text-ink-3">Fee {spec.feeBps} bp. Everyone in the batch gets the same price.</p>
    </section>
  );
}
