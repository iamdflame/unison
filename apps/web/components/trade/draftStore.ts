"use client";

import { createStore } from "@/lib/store/createStore";

/**
 * The order being composed in the ticket, before it is placed: the batch chart draws its limit, so you can see where
 * your order would sit against everyone else's before you send it.
 */
export interface DraftOrder {
  ticker: string;
  side: "buy" | "sell";
  tick: number;
}

export const draft = createStore<DraftOrder | null>(null);
