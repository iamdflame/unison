import { facts } from "@/lib/content/facts";

/** The movement's six plates, top to bottom: the name of each layer and the one line it gets. */
export const PLATES = [
  { name: "Gateway", line: "Orders signed with a passkey, a wallet, or an agent key with limits. Relayed without gas." },
  { name: "Book", line: `Every price level of a batch, aggregated in page-aligned storage, so an order costs about $${facts.gas.orderUsd}.` },
  { name: "Clearing", line: "One uniform price: the most volume, then the least imbalance, then the closest to the reference." },
  { name: "References", line: "Chainlink's own observation, made after the orders are sealed and proven on chain to be the first." },
  { name: "Vault", line: "Liquidity that quotes around the reference and has nothing to lose to snipers." },
  { name: "Compliance", line: "Volume caps, eligibility and halts from the SEC's tokenized-venue rules, written as code." },
] as const;
