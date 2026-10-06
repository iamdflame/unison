import type { Address } from "viem";
import mainnet from "../../../../deployments/monad-mainnet.json" with { type: "json" };

/**
 * Unison on Monad mainnet, from the repository's own deployment record (bundled at build time, so the plugin trades
 * exactly the contracts the site, the keeper and the indexer use).
 */
export const CHAIN_ID = 143;
export const RPC_URL = "https://rpc.monad.xyz";
export const SITE = "https://www.unisonfi.com";
export const EXPLORER = "https://monadvision.com";

export interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

export interface Market {
  id: number;
  symbol: string;
  base: Token;
  quote: Token;
  /** priced at the first Chainlink observation after its orders are sealed (SPEC §7.4) */
  causal: boolean;
  /** kept on the old rule as the standing challenge's baseline: never for trading */
  control: boolean;
}

export const exchange = mainnet.exchange as Address;
export const causalReference = mainnet.causalReference as Address;
export const challenges = { causal: mainnet.challenge.unison as Address, old: mainnet.challenge.control as Address };
export const team = [mainnet.adversary.address, ...mainnet.adversary.accounts].map((a) => a.toLowerCase());

export const tokens: Token[] = Object.values(mainnet.tokens).map((t) => ({ symbol: t.symbol, address: t.address as Address, decimals: t.decimals }));
const tokenAt = (address: string) => {
  const t = tokens.find((x) => x.address.toLowerCase() === address.toLowerCase());
  if (!t) throw new Error(`no token at ${address} in the deployment record`);
  return t;
};

export const markets: Market[] = Object.entries(mainnet.markets as Record<string, { id: number; base: string; quote: string; reference: string; control?: boolean }>)
  .map(([symbol, m]) => ({
    id: m.id,
    symbol,
    base: tokenAt(m.base),
    quote: tokenAt(m.quote),
    causal: m.reference === "chainlink-causal",
    control: m.control === true,
  }))
  .sort((a, b) => a.id - b.id);

/** A market by id ("1"), pair ("WMON/AUSD") or base symbol ("WMON", "aNVDA", "NVDA"); the control market only by id. */
export function marketByName(name: string): Market | undefined {
  const n = name.trim().toLowerCase();
  if (/^\d+$/.test(n)) return markets.find((m) => m.id === Number(n));
  const tradable = markets.filter((m) => !m.control);
  return (
    tradable.find((m) => m.symbol.toLowerCase() === n) ??
    tradable.find((m) => m.base.symbol.toLowerCase() === n) ??
    tradable.find((m) => m.base.symbol.toLowerCase().replace(/^a/, "") === n)
  );
}

export function tokenByName(name: string): Token | undefined {
  const n = name.trim().toLowerCase();
  return tokens.find((t) => t.symbol.toLowerCase() === n || t.address.toLowerCase() === n);
}

export const receiptUrl = (marketId: number | bigint, upTo: bigint) => `${SITE}/receipt/mainnet/${marketId}/${upTo}`;
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
