"use client";

import { priceFormat, type MarketSpec } from "@/lib/content/markets";
import type { MyFill } from "@/lib/demo/engine";
import { createStore } from "@/lib/store/createStore";
import type { NetConfig } from "@/lib/venue/config";
import { identity } from "@/lib/venue/identity";

/** What a certificate of execution shows; set `certificate` to open one from anywhere (the dialog loads then). */
export interface CertificateData extends MyFill {
  ticker: string;
  name: string;
  unit: number;
  decimals: number;
  /** the market's fee on each fill */
  feeBps: number;
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
    feeBps: spec.feeBps,
    ...(net && account && marketId !== undefined ? { live: { tapeUrl: net.tapeUrl, marketId, account, slot: fill.orderId, explorer: net.explorer } } : {}),
  };
}
