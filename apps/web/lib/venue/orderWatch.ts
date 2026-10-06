"use client";

import { toast } from "@/lib/ui/toast";
import { account as demoAccount, type MyFill } from "../demo/engine.ts";
import { venue } from "./index.ts";
import { liveAccount, orderAliases } from "./live.ts";

/**
 * Follows a submitted order to its outcome and tells you in one toast: filled at the batch's one price, resting,
 * or expired. It lives outside any component, so closing the ticket's sheet or changing page mid-batch never
 * leaves a toast spinning.
 *
 * Live slots are reused once an order is done, and the relayer can report a slot before the tape has indexed the
 * new order. So a match needs the same slot, side and limit, placed no earlier than the batch it was sent into.
 */
export interface OrderWatch {
  /** optimistic id (live: until the relayer reports the slot) */
  id: number;
  ticker: string;
  side: "buy" | "sell";
  limit: number;
  ioc: boolean;
  /** a causal market's auction order (SPEC §7.4): it waits, sealed, for Chainlink's next observation */
  causal?: boolean;
  /** batch (block) the order was sent into */
  block: number;
  toastId: string | number;
  fmt: (tick: number) => string;
  onCertificate: (fill: MyFill) => void;
}

const watches = new Map<string, OrderWatch>();
let stop: (() => void) | null = null;

export function watchOrder(w: OrderWatch) {
  watches.set(`${w.ticker}:${w.id}`, w);
  if (!stop) {
    const offs = [demoAccount.subscribe(check), liveAccount.subscribe(check), orderAliases.subscribe(check)];
    stop = () => offs.forEach((off) => off());
  }
  check();
}

function check() {
  for (const [key, w] of watches) if (settle(w)) watches.delete(key);
  if (watches.size === 0 && stop) {
    stop();
    stop = null;
  }
}

/** Resolves the toast if the order has an outcome; returns whether it did. */
function settle(w: OrderWatch): boolean {
  const live = venue.get().mode === "live";
  const acct = (live ? liveAccount : demoAccount).get();
  const id = live ? orderAliases.get()[w.id] : w.id;
  if (id === undefined) return false;
  const o = (acct.orders[w.ticker] ?? []).find((x) => x.id === id && x.side === w.side && x.tick === w.limit && x.placedBlock >= w.block - 2);
  if (!o) return false;

  if (o.status === "filled" || o.status === "partial") {
    const fill = acct.fills.find((f) => f.ticker === w.ticker && f.orderId === id && f.block >= w.block - 2); // newest first
    const price = fill ? w.fmt(fill.tick) : `$${(o.quote / o.filled).toFixed(2)}`;
    const rest = o.status !== "partial" ? "" : w.ioc ? " The rest was released." : " The rest stays in the book at your limit.";
    // a fraction of a share keeps its digits: 0.0067 is not 0.01
    const q = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: x < 1 ? 4 : 2 });
    toast.success(`${w.side === "buy" ? "Bought" : "Sold"} ${q(o.filled)}${o.status === "partial" ? ` of ${q(o.qty)}` : ""} ${w.ticker} at ${price}`, {
      id: w.toastId,
      description: `The same price as everyone in block ${(fill?.block ?? o.batches.at(-1) ?? o.placedBlock).toLocaleString("en-US")}.${rest}`,
      action: fill ? { label: "Certificate", onClick: () => w.onCertificate(fill) } : undefined,
      duration: 8000,
    });
    return true;
  }
  if (o.status === "expired") {
    toast(w.causal ? "Not filled in its auction" : "Not filled this batch", {
      id: w.toastId,
      description: w.causal
        ? "Nothing met your limit at Chainlink's next price. Your funds are back."
        : "Your this-batch-only order expired and your funds are released.",
    });
    return true;
  }
  if (o.status === "cancelled") {
    toast("Cancelled", { id: w.toastId, description: "Your funds are released." });
    return true;
  }
  if (o.status === "open" && !o.settling) {
    toast(`Resting at ${w.fmt(w.limit)}`, { id: w.toastId, description: "It joins every batch until it fills or you cancel it." });
    return true;
  }
  return false;
}
