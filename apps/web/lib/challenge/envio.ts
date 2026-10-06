/**
 * Every challenge account and its score, from the Envio HyperIndex indexer (services/indexer), which marks each fill
 * to Chainlink exactly as LatencyChallenge.edgeOf does. Read on the server when the page revalidates; nothing here
 * runs in the browser.
 */
export interface Challenger {
  account: string;
  owner: string;
  rule: "causal" | "old" | "unknown";
  paid: boolean;
  orders: number;
  fills: number;
  counted: number;
  pendingMarks: number;
  /** quote units (AUSD, 6 decimals) */
  edge: bigint;
  notional: bigint;
  edgeBps: number;
}

const QUERY = `{
  Account(order_by: { edgeBps: desc }, limit: 100) {
    id owner orders fills counted pendingMarks edge notional edgeBps
    challenge { id rule paid }
  }
}`;

interface Row {
  id: string;
  owner: string;
  orders: number;
  fills: number;
  counted: number;
  pendingMarks: number;
  edge: string;
  notional: string;
  edgeBps: number;
  challenge: { id: string; rule: string; paid: boolean } | null;
}

export const envioUrl = () => process.env.ENVIO_GRAPHQL_URL ?? process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL;

/** The challengers, best edge first; null when the indexer isn't configured or doesn't answer. */
export async function loadChallengers(revalidate: number): Promise<Challenger[] | null> {
  const url = envioUrl();
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
      next: { revalidate },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { Account?: Row[] } };
    const rows = body.data?.Account;
    if (!Array.isArray(rows)) return null;
    return rows.map((r) => ({
      account: r.id,
      owner: r.owner,
      rule: r.challenge?.rule === "causal" || r.challenge?.rule === "old" ? r.challenge.rule : "unknown",
      paid: r.challenge?.paid ?? false,
      orders: Number(r.orders),
      fills: Number(r.fills),
      counted: Number(r.counted),
      pendingMarks: Number(r.pendingMarks),
      edge: BigInt(r.edge),
      notional: BigInt(r.notional),
      edgeBps: Number(r.edgeBps),
    }));
  } catch {
    return null;
  }
}
