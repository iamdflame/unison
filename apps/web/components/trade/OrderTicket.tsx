"use client";

import { buyLock } from "@unison/engine";
import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccount, useDemoMarket } from "@/lib/demo/useMarket";
import { clearBatch } from "@/lib/sim/batch";

/**
 * The order ticket. Every number on it is exact: the lock is the contract's `buyLock` (notional at your limit plus
 * the maximum fee), and the indicative fill runs the clearing engine on the live book with your order added.
 */
const MAX_FEE_BPS = 10n;

export function OrderTicket({ ticker }: { ticker: string }) {
  const { market, value: m, spec } = useDemoMarket(ticker, (s) => ({ refTick: s.refTick, lo: s.lo, hi: s.hi, book: s.book }));
  const free = useAccount((a) => ({ quote: a.quote, base: a.base[ticker] ?? 0 }));
  const unit = Number(spec.tickSize) / 1e6;
  const decimals = unit >= 0.01 ? 2 : unit >= 0.0001 ? 4 : 6;
  const fmt = (t: number) => `$${(t * unit).toFixed(decimals)}`;

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [offsetTicks, setOffsetTicks] = useState(2); // limit = reference + offset (buys) or − offset (sells)
  const [qtyText, setQtyText] = useState("1");
  const [ioc, setIoc] = useState(false);
  const qty = Math.max(0, Number(qtyText) || 0);
  const limit = side === "buy" ? m.refTick + offsetTicks : m.refTick - offsetTicks;

  const lock = useMemo(() => {
    if (side === "sell") return qty;
    const l = buyLock(BigInt(Math.round(qty * 1e6)), BigInt(Math.round(limit * unit * 1e6)), MAX_FEE_BPS, 1_000_000n);
    return Number(l) / 1e6;
  }, [side, qty, limit, unit]);
  const affordable = side === "buy" ? lock <= free.quote : qty <= free.base;
  const inBand = limit >= m.lo && limit <= m.hi;

  // What would happen if the batch cleared now: the engine on the live book, the vault, and you.
  const indicative = useMemo(() => {
    if (qty <= 0) return null;
    const vault = [];
    for (let k = 0; k < 6; k++) {
      vault.push({ id: -1 - k, side: "buy" as const, tick: m.refTick - 6 - k * 2, qty: 3 + k });
      vault.push({ id: -100 - k, side: "sell" as const, tick: m.refTick + 6 + k * 2, qty: 3 + k });
    }
    const out = clearBatch([...m.book, ...vault, { id: 0, side, tick: limit, qty }], { lo: m.lo, hi: m.hi, refTick: m.refTick });
    return out.traded ? { tick: out.tick, filled: out.fills.get(0) ?? 0 } : null;
  }, [m.book, m.refTick, m.lo, m.hi, side, limit, qty]);

  const maxQty = side === "buy" ? Math.floor((free.quote / (limit * unit * 1.001)) * 100) / 100 : free.base;
  const [pendingId, setPendingId] = useState<number | null>(null);
  const toastId = useRef<string | number | null>(null);
  const status = useAccount((a) => {
    const o = pendingId ? (a.orders[ticker] ?? []).find((x) => x.id === pendingId) : undefined;
    return o ? { status: o.status, filled: o.filled, qty: o.qty, quote: o.quote, batch: o.batches.at(-1) ?? null } : null;
  });

  // The toast follows your order: in the batch → filled at the one price (or rests, or expires).
  useEffect(() => {
    if (!status || toastId.current === null) return;
    const id = toastId.current;
    const avg = status.filled > 0 ? status.quote / status.filled : 0;
    if (status.status === "filled" || status.status === "partial") {
      toast.success(`${side === "buy" ? "Bought" : "Sold"} ${status.filled.toFixed(2)} ${ticker} at $${avg.toFixed(decimals)}`, {
        id,
        description: `The same price as everyone in batch ${status.batch?.toLocaleString("en-US") ?? ""}.`,
      });
      toastId.current = null;
    } else if (status.status === "expired") {
      toast(`Not filled this batch`, { id, description: "This-batch-only order expired; your funds are released." });
      toastId.current = null;
    } else if (status.status === "open") {
      toast(`Resting at ${fmt(limit)}`, { id, description: "It joins every batch until it fills or you cancel it." });
      toastId.current = null;
    }
  }, [status, side, ticker, decimals, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (qty <= 0 || !affordable) return;
    const r = market.place(side, limit, Math.round(qty * 100) / 100, ioc);
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    setPendingId(r.id);
    toastId.current = toast.loading(`${side === "buy" ? "Buy" : "Sell"} ${qty} ${ticker} in the next batch`, {
      description: `Limit ${fmt(limit)} · clears in about 0.3 s`,
    });
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
              side === s ? (s === "buy" ? "bg-buy text-bg shadow-sm" : "bg-sell text-bg shadow-sm") : "text-ink-2 hover-fine:text-ink"
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
            className={`press rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${offsetTicks === c ? "bg-ink text-bg" : "bg-sunken text-ink-2 hover-fine:text-ink"}`}
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
          <button key={f} type="button" onClick={() => setQtyText(String(Math.floor(maxQty * f * 100) / 100))} className="press flex-1 rounded-full bg-sunken py-1 text-xs font-medium text-ink-2 hover-fine:text-ink">
            {f === 1 ? "Max" : `${f * 100}%`}
          </button>
        ))}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={ioc}
        onClick={() => setIoc((v) => !v)}
        className="mt-4 flex w-full items-center justify-between rounded-2xl px-1 py-1 text-sm text-ink-2"
      >
        This batch only
        <span className={`relative h-6 w-10 rounded-full transition-colors duration-200 ${ioc ? "bg-ink" : "bg-sunken"}`}>
          <span className={`absolute top-0.5 size-5 rounded-full bg-raised shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${ioc ? "translate-x-[18px]" : "translate-x-0.5"}`} />
        </span>
      </button>

      <dl id="qty-help" className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-3">{side === "buy" ? "You lock at most" : "You lock"}</dt>
          <dd className="tnum text-ink">{side === "buy" ? `$${lock.toFixed(2)}` : `${lock} ${ticker}`}</dd>
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
        disabled={qty <= 0 || !affordable}
        className={`press mt-5 w-full rounded-full py-3.5 text-[15px] font-semibold text-bg shadow-md transition-opacity disabled:opacity-40 ${side === "buy" ? "bg-buy" : "bg-sell"}`}
      >
        {!affordable ? (side === "buy" ? "Not enough AUSD" : `Not enough ${ticker}`) : `${side === "buy" ? "Buy" : "Sell"} ${qty || ""} ${ticker}`}
      </button>
      <p className="mt-3 text-center text-xs text-ink-3">Fee {spec.feeBps} bp. Everyone in the batch gets the same price.</p>
    </section>
  );
}
