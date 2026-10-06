import { type Address, decodeErrorResult, erc20Abi, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { challengeAccountAbi, latencyChallengeAbi, unisonExchangeAbi } from "@unison/sdk/abis/index.ts";

/**
 * What an action needs from outside: chain reads, and for writes the agent's address and a way to send through its
 * wallet. The MetaMask host provides them (host.ts); tests provide fakes, or an anvil fork of Monad mainnet.
 */
export interface Reader {
  client: PublicClient;
}

export interface Writer extends Reader {
  account: Address;
  /** Sends one call through the agent's wallet and resolves once it is mined and succeeded. */
  send(call: Call): Promise<Sent>;
}

export interface Call {
  to: Address;
  data: Hex;
  value?: bigint;
  /** One line a person approving the transaction reads, e.g. "Unison: sealed buy of 10 WMON at ≤ 0.0290 AUSD". */
  summary: string;
  details?: Record<string, string>;
}

export interface Sent {
  hash: Hex;
  receipt: TransactionReceipt;
}

/** A failure with a code an agent can branch on, and a hint a person can act on. */
export class UnisonError extends Error {
  readonly code: string;
  readonly hint: string;
  constructor(code: string, message: string, hint: string) {
    super(message);
    this.name = "UnisonError";
    this.code = code;
    this.hint = hint;
  }
}

const ABIS = [...unisonExchangeAbi, ...latencyChallengeAbi, ...challengeAccountAbi, ...erc20Abi];

/** What each revert means for the person or agent who caused it. */
const HINTS: Record<string, string> = {
  InsufficientBalance: "Your Unison balance doesn't cover it. Check `mm unison balance`, then `mm unison deposit <amount>`.",
  MarketInactive: "The market is not trading. `mm unison markets` shows each market's state.",
  InvalidTick: "The limit price is outside the market's price grid.",
  TickOutOfRange: "The limit price is outside the market's price grid.",
  InvalidQty: "The quantity must be more than zero.",
  NoFreeOrderSlot: "Every order slot is in use. Claim settled orders first: `mm unison claim`.",
  PendingFull: "The market's queue of auctions is full for a moment. Try again in a few seconds.",
  NotEligible: "This market is permissioned and the account isn't eligible.",
  EnforcedPause: "The venue is paused.",
  Sealed: "The order is sealed in an auction that hasn't run yet; it can't be cancelled now.",
  Team: "The Unison team's addresses can't enter the challenge.",
  AlreadyOpen: "This wallet already has a challenge account. `mm unison challenge score` shows it.",
  Closed: "The challenge has paid out or its window has ended.",
  NotEnoughFills: "Not enough counted fills yet. The pot needs at least the minimum (see `mm unison challenge score`).",
  NoEdge: "The fills don't show an edge above the threshold, so the pot can't pay.",
  UnknownAccount: "That isn't a challenge account.",
  OrderOpen: "The account has an order in flight. Settle it first: `mm unison challenge settle`.",
  NoOrder: "The account has no order in flight.",
  AuctionNotRun: "The order's auction hasn't run yet. Chainlink observes MON about every 30 seconds; try again shortly.",
  NotOwner: "Only the account's owner can do that.",
};

/** The revert's name and arguments, from any error viem raised for a call that would fail. */
export function explainRevert(e: unknown): { name: string; text: string; hint: string } {
  for (let x: unknown = e; x; x = (x as { cause?: unknown }).cause) {
    const data = (x as { data?: unknown }).data;
    const hex = typeof data === "string" ? data : typeof (data as { data?: unknown })?.data === "string" ? (data as { data: string }).data : undefined;
    if (hex && /^0x[0-9a-fA-F]{8}/.test(hex)) {
      try {
        const d = decodeErrorResult({ abi: ABIS, data: hex as Hex });
        const args = (d.args ?? []).map(String).join(", ");
        return { name: d.errorName, text: `${d.errorName}(${args})`, hint: HINTS[d.errorName] ?? "" };
      } catch {
        /* not one of ours */
      }
    }
  }
  const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? String(e);
  return { name: "Unknown", text: msg.split("\n")[0] ?? msg, hint: "" };
}
