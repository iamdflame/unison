"use client";

import type { VaultFlow, VaultPoint } from "@unison/sdk/tape";
import { useEffect, useMemo, useState } from "react";
import { SIM_VAULT_NAV } from "../demo/engine.ts";
import type { Address } from "viem";
import type { MarketSpec } from "../content/markets.ts";
import { useMarket, useVenue } from "./index.ts";
import { liveClients } from "./live.ts";

/** A market's vault as the chain and the tape report it. Amounts in AUSD and base units as plain numbers. */
export interface VaultLive {
  address: string;
  baseBalance: bigint;
  quoteBalance: bigint;
  base: number;
  quote: number;
  supply: number;
  spreadPnl: number;
  inventoryPnl: number;
  pending: number;
  auctionsTraded: number;
  tradedBase: number;
  history: VaultPoint[];
  flows: VaultFlow[];
}

const Q = 1e6; // AUSD decimals
const SHARE_DECIMALS = 12; // quote decimals + 6 (LiquidityVault.decimals)

/**
 * A market's vault as the page should show it: the chain's (live), or the simulation's own books, kept by the
 * in-browser venue as LiquidityVault keeps them (address "simulation", shares issued at $1 for its starting value).
 */
export function useVaultView(spec: MarketSpec): VaultLive | null {
  const v = useVenue();
  const live = useVaultLive(spec);
  const { value: book } = useMarket(spec.ticker, (s) => s.vaultBook ?? null, undefined, { book: false });
  return useMemo(() => {
    if (v.mode === "live") return live;
    if (!book) return null;
    return {
      address: "simulation",
      baseBalance: BigInt(Math.round(book.base * 1e6)) * 10n ** 12n,
      quoteBalance: BigInt(Math.round(book.quote * 1e6)),
      base: book.base,
      quote: book.quote,
      supply: SIM_VAULT_NAV,
      spreadPnl: book.spreadPnl,
      inventoryPnl: book.inventoryPnl,
      pending: 0,
      auctionsTraded: book.auctionsTraded,
      tradedBase: book.tradedBase,
      history: [],
      flows: [],
    };
  }, [v.mode, live, book]);
}

/** Polls the vault every 10 s while mounted; null in the simulation or for a market without a deployed vault. */
export function useVaultLive(spec: MarketSpec): VaultLive | null {
  const v = useVenue();
  const address = v.mode === "live" && v.net ? v.net.deployment.markets[spec.symbol]?.vault : undefined;
  const [state, setState] = useState<VaultLive | null>(null);

  useEffect(() => {
    if (!address || !v.net) return;
    const net = v.net;
    const { tape } = liveClients(net);
    let alive = true;
    const load = async () => {
      const { chainClient } = await import("./chain.ts");
      const [vault, history, flows] = await Promise.all([
        chainClient(net).vault(address as Address),
        tape.vaultHistory(address, { res: "1h" }).catch(() => [] as VaultPoint[]),
        tape.vaultFlows(address).catch(() => [] as VaultFlow[]),
      ]);
      if (!alive) return;
      setState({
        address,
        baseBalance: vault.baseBalance,
        quoteBalance: vault.quoteBalance,
        base: Number(vault.baseBalance) / 1e18,
        quote: Number(vault.quoteBalance) / Q,
        supply: Number(vault.totalSupply) / 10 ** SHARE_DECIMALS,
        spreadPnl: Number(vault.spreadPnl) / Q,
        inventoryPnl: Number(vault.inventoryPnl) / Q,
        pending: Number(vault.pendingRequests),
        auctionsTraded: Number(vault.auctionsTraded),
        tradedBase: Number(vault.tradedBase) / 1e18,
        history,
        flows,
      });
    };
    void load().catch(() => undefined);
    const t = setInterval(() => void load().catch(() => undefined), 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address, v.net]);

  return address ? state : null;
}
