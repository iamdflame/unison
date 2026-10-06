import { InputFieldType } from "@metamask/agent-wallet/plugin";

/** Inputs the commands share. Each becomes a flag, and with an index a positional too. */

export const marketInput = (index: number) =>
  ({ type: InputFieldType.Text, flag: "market", message: "Market: WMON, aNVDA, a pair like WMON/AUSD, or its id", required: true, prompt: false, index }) as const;

export const sideInput = (index: number) =>
  ({
    type: InputFieldType.Select,
    flag: "side",
    message: "buy or sell",
    options: [
      { value: "buy", label: "Buy" },
      { value: "sell", label: "Sell" },
    ],
    required: true,
    prompt: false,
    index,
  }) as const;

export const quantityInput = (index: number) =>
  ({ type: InputFieldType.Text, flag: "quantity", message: "How many base tokens, e.g. 10 (WMON) or 0.01 (aNVDA)", required: true, prompt: false, index }) as const;

export const limitInput = {
  type: InputFieldType.Text,
  flag: "limit",
  message: "Limit price in the quote token, e.g. 0.0295. By default, --slippage past Chainlink's newest observation",
  required: false,
  prompt: false,
} as const;

export const slippageInput = {
  type: InputFieldType.Text,
  flag: "slippage",
  message: "How far past Chainlink's newest observation the default limit sits, in basis points (default 50)",
  required: false,
  prompt: false,
} as const;

export const amountInput = (index: number, message = "Amount, e.g. 2") => ({ type: InputFieldType.Text, flag: "amount", message, required: true, prompt: false, index }) as const;

export const tokenInput = (index: number) =>
  ({ type: InputFieldType.Text, flag: "token", message: "Token: AUSD (default), WMON or aNVDA", required: false, prompt: false, index }) as const;

export const ruleInput = {
  type: InputFieldType.Select,
  flag: "rule",
  message: "Which challenge: causal (Unison's market, the default) or old (the control market)",
  options: [
    { value: "causal", label: "Causal (Unison)" },
    { value: "old", label: "Old rule (control)" },
  ],
  required: false,
  prompt: false,
} as const;

export const addressInput = {
  type: InputFieldType.Text,
  flag: "address",
  message: "Any address (default: the agent wallet's)",
  required: false,
  prompt: false,
} as const;

/** "50" → 50; undefined → undefined; anything else is refused. */
export function bps(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`"${v}" is not a number of basis points`);
  return n;
}
