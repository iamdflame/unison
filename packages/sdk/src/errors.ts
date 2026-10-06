/**
 * Human-readable Unison reverts. One table for the exchange, the gateway and the vaults, so the relayer, the
 * tape, apps and agents say the same thing about the same failure:
 *
 *   try { await client.placeOrder(a) } catch (e) { toast(decodeUnisonError(e).message) }
 *
 * Accepts viem errors (simulate / estimate / write), raw revert data (e.g. a `RelayFailed` reason), JSON-RPC
 * error objects and bare error names.
 */
import { decodeErrorResult, toFunctionSelector, type Abi, type Hex } from "viem";
import { unisonExchangeAbi } from "./abis/UnisonExchange.ts";
import { orderGatewayAbi } from "./abis/OrderGateway.ts";
import { liquidityVaultAbi } from "./abis/LiquidityVault.ts";
import { chainlinkCausalReferenceAbi } from "./abis/ChainlinkCausalReference.ts";

type AbiError = Extract<Abi[number], { type: "error" }>;

export interface UnisonErrorInfo {
  /** custom-error name (e.g. "InsufficientBalance"), or "UNKNOWN" when nothing could be decoded */
  code: string;
  message: string;
}

export const UNKNOWN_ERROR_MESSAGE = "Something went wrong on-chain.";

export const UNISON_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  InsufficientBalance: "Not enough free balance. Deposit first; funds in open orders are locked.",
  InvalidTick: "Price is outside the market's allowed range.",
  InvalidQty: "Quantity must be above 0.",
  MarketInactive: "This market is inactive.",
  InvalidMarket: "Unknown market.",
  UnknownToken: "This token isn't listed.",
  NoFreeOrderSlot: "You have 55 open orders. Claim or cancel some first.",
  EmptySlot: "This order is already settled or cancelled.",
  NotEligible: "Your account isn't eligible for this market.",
  ClearInProgress: "An auction is being applied right now. Retry next block.",
  TooEarly: "Overnight call auction: the next auction is a few blocks away.",
  StaleReference: "The reference price for this batch isn't published yet.",
  PendingFull: "Too many uncleared batches. Anyone can clear the market.",
  TooManyGroups: "Too many distinct prices in this block. Try the next block.",
  EnforcedPause: "Trading is paused. You can still cancel, claim and withdraw.",
  Expired: "This signature expired. Sign again.",
  NonceUsed: "Already submitted.",
  BadSignature: "The signature didn't verify.",
  SessionNotAllowed: "Session keys can't do that; sign with the account.",
  SessionExpired: "This session key has expired or was revoked.",
  SessionCap: "Over this session key's limits: a market it may not trade, or too large an order.",
  UnknownPasskey: "This passkey isn't registered yet.",
  ClearRunning: "The vault is waiting for the current auction; retry in a moment.",
  Sealed: "This order is sealed into its auction. It settles when Chainlink's next price lands.",
  NotYet: "Waiting for Chainlink's next observation of this market.",
  NotAfterSeal: "That Chainlink observation was made before the auction sealed.",
  NotFirstObservation: "An earlier Chainlink observation after the seal exists; the auction must use it.",
  ObservationExists: "A Chainlink observation after the seal exists; the auction must use it.",
  BadQuoteRound: "That quote-feed round wasn't the one in force at the observation.",
};

const signature = (e: AbiError) => `${e.name}(${e.inputs.map((i) => i.type).join(",")})`;

/** Every custom error the exchange, gateway and vaults can revert with, deduplicated by signature. */
export const unisonErrorsAbi: readonly AbiError[] = (() => {
  const seen = new Map<string, AbiError>();
  for (const item of [...unisonExchangeAbi, ...orderGatewayAbi, ...liquidityVaultAbi, ...chainlinkCausalReferenceAbi] as Abi) {
    if (item.type === "error" && !seen.has(signature(item))) seen.set(signature(item), item);
  }
  return [...seen.values()];
})();

const bySelector = new Map(unisonErrorsAbi.map((e) => [toFunctionSelector(signature(e)), e.name]));
const knownNames = new Set(unisonErrorsAbi.map((e) => e.name));

const isHex = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v);

/** Error name from revert data, or undefined when it isn't a known selector (empty reverts included). */
function nameFromData(data: Hex): string | undefined {
  if (data.length < 10) return undefined;
  try {
    return decodeErrorResult({ abi: unisonErrorsAbi, data }).errorName; // also Error(string) / Panic(uint256)
  } catch {
    return bySelector.get(data.slice(0, 10).toLowerCase() as Hex);
  }
}

function nameFrom(err: unknown, depth = 0): string | undefined {
  if (err === null || err === undefined || depth > 12) return undefined;
  if (typeof err === "string") {
    if (isHex(err)) return nameFromData(err);
    return knownNames.has(err) || err in UNISON_ERROR_MESSAGES ? err : undefined;
  }
  if (typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  // viem ContractFunctionRevertedError: `data` is the decoded result when the call's ABI knew the error
  const data = e.data;
  if (data && typeof data === "object" && typeof (data as { errorName?: unknown }).errorName === "string") {
    return (data as { errorName: string }).errorName;
  }
  if (typeof e.errorName === "string") return e.errorName;
  for (const v of [data, e.raw, (data as { data?: unknown } | undefined)?.data]) {
    if (isHex(v)) {
      const n = nameFromData(v);
      if (n) return n;
    }
  }
  if (typeof e.signature === "string" && bySelector.has(e.signature.toLowerCase() as Hex)) {
    return bySelector.get(e.signature.toLowerCase() as Hex);
  }
  // viem cause chains, and raw JSON-RPC responses ({ error: { code, message, data } })
  const nested = nameFrom(e.cause, depth + 1) ?? nameFrom(e.error, depth + 1);
  if (nested) return nested;
  // last resort: the formatted message ("Error: InsufficientBalance()", "custom error 0x…")
  const msg = typeof e.message === "string" ? e.message : "";
  const named = /\b([A-Z][A-Za-z0-9]+)\(\)/.exec(msg)?.[1];
  if (named && knownNames.has(named)) return named;
  const sel = /0x[0-9a-fA-F]{8}\b/.exec(msg)?.[0];
  return sel ? bySelector.get(sel.toLowerCase() as Hex) : undefined;
}

/** Decodes any Unison revert into `{ code, message }` (code = custom-error name, or "UNKNOWN"). */
export function decodeUnisonError(err: unknown): UnisonErrorInfo {
  const code = nameFrom(err);
  if (!code) return { code: "UNKNOWN", message: UNKNOWN_ERROR_MESSAGE };
  return { code, message: UNISON_ERROR_MESSAGES[code] ?? UNKNOWN_ERROR_MESSAGE };
}
