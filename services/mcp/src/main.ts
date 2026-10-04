/**
 * Unison MCP server (stdio). Gives an AI agent read access to Unison and lets it trade FOR a human account
 * through a session key that account granted on the OrderGateway — the gateway enforces the caps (markets,
 * max qty, max notional, expiry) and session keys can never withdraw.
 *
 * Env: DEPLOYMENT (deployments/<chain>.json), RPC_URL, AGENT_PRIVATE_KEY (the session key),
 *      AGENT_ACCOUNT (the human account it trades for), RELAYER_URL (http://127.0.0.1:8788)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPublicClient, erc20Abi, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildCancel,
  buildOrder,
  chainById,
  formatUnitsExact,
  loadDeploymentFile,
  orderToJson,
  parseUnitsExact,
  RelayerClient,
  Side,
  signAsSession,
  statusName,
  tickOfPrice,
  UnisonClient,
  unisonExchangeAbi,
} from "@unison/sdk";

const env = (k: string, d?: string) => process.env[k] ?? d;

async function main() {
  const deployment = await loadDeploymentFile(env("DEPLOYMENT", "deployments/31337.json")!);
  const chain = chainById(deployment.chainId);
  const publicClient = createPublicClient({ chain, transport: http(env("RPC_URL", chain.rpcUrls.default.http[0])) });
  const client = new UnisonClient({ publicClient, deployment });
  const relayer = env("RELAYER_URL", "http://127.0.0.1:8788")!;
  const agentKey = env("AGENT_PRIVATE_KEY") ? privateKeyToAccount(env("AGENT_PRIVATE_KEY") as Hex) : undefined;
  const agentAccount = env("AGENT_ACCOUNT") as Address | undefined;

  const decimalsCache = new Map<Address, number>();
  const decimals = async (token: Address) => {
    if (!decimalsCache.has(token)) {
      decimalsCache.set(token, await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }));
    }
    return decimalsCache.get(token)!;
  };
  const market = (symbol: string) => {
    const m = deployment.markets[symbol];
    if (!m) throw new Error(`unknown market ${symbol}; use the "markets" tool`);
    return m;
  };
  const text = (v: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2) }],
  });

  const server = new McpServer({ name: "unison", version: "0.1.0" });

  server.registerTool(
    "markets",
    { description: "List Unison markets with their live reference price, session status and last auction print." },
    async () => {
      const out = [];
      for (const m of Object.values(deployment.markets)) {
        const s = await client.market(BigInt(m.id));
        const qd = await decimals(m.quote);
        out.push({
          symbol: m.symbol,
          id: m.id,
          reference: formatUnitsExact(s.lastRefPrice, qd),
          status: statusName(s.lastStatus),
          lastPrint: s.lastPrintTick === 0n ? null : formatUnitsExact(s.lastPrintTick * s.tickSize, qd),
          auctions: s.auctions,
          vault: m.vault ?? null,
        });
      }
      return text(out);
    },
  );

  server.registerTool(
    "market",
    {
      description:
        "Detail of one market: reference, regime, the auction band a clear would use now, remaining daily volume cap, liquidity sources.",
      inputSchema: { symbol: z.string().describe('e.g. "aNVDA/AUSD"') },
    },
    async ({ symbol }) => {
      const m = market(symbol);
      const id = BigInt(m.id);
      const s = await client.market(id);
      const qd = await decimals(m.quote);
      const band = await client.previewBand(id, s.lastRefPrice, s.lastStatus as 0 | 1 | 2 | 3);
      const [, remaining] = await publicClient.readContract({
        address: deployment.exchange,
        abi: unisonExchangeAbi,
        functionName: "capsOf",
        args: [id],
      });
      return text({
        symbol,
        reference: formatUnitsExact(s.lastRefPrice, qd),
        status: statusName(s.lastStatus),
        band: {
          low: formatUnitsExact(band.lo * s.tickSize, qd),
          high: formatUnitsExact(band.hi * s.tickSize, qd),
          halfWidthBps: band.bandBps,
        },
        tickSize: formatUnitsExact(s.tickSize, qd),
        remainingDailyCap: remaining === 2n ** 256n - 1n ? "uncapped" : remaining,
        feeBps: s.feeBps,
        sources: await client.sources(id),
      });
    },
  );

  server.registerTool(
    "depth",
    {
      description: "Order-book depth around the reference (resting quantity per price level, aggregated over all books).",
      inputSchema: { symbol: z.string(), levels: z.number().int().min(1).max(200).optional() },
    },
    async ({ symbol, levels }) => {
      const m = market(symbol);
      const id = BigInt(m.id);
      const s = await client.market(id);
      const [qd, bd] = [await decimals(m.quote), await decimals(m.base)];
      const n = BigInt(levels ?? 20);
      const ref = s.lastRefPrice / s.tickSize;
      const [bids, asks] = await Promise.all([
        client.depth(id, Side.BID, ref - n, ref + n),
        client.depth(id, Side.ASK, ref - n, ref + n),
      ]);
      const ladder = (arr: readonly bigint[]) =>
        arr
          .map((q, i) => ({ price: formatUnitsExact((ref - n + BigInt(i)) * s.tickSize, qd), qty: formatUnitsExact(q, bd) }))
          .filter((x) => x.qty !== "0");
      return text({ symbol, reference: formatUnitsExact(s.lastRefPrice, qd), bids: ladder(bids).reverse(), asks: ladder(asks) });
    },
  );

  server.registerTool(
    "tape",
    {
      description: "Recent auction prints (one uniform price per batch) for a market.",
      inputSchema: { symbol: z.string(), blocks: z.number().int().min(1).max(100).optional() },
    },
    async ({ symbol, blocks }) => {
      const m = market(symbol);
      const head = await publicClient.getBlockNumber();
      const logs = await publicClient.getContractEvents({
        address: deployment.exchange,
        abi: unisonExchangeAbi,
        eventName: "BatchCleared",
        args: { marketId: BigInt(m.id) },
        fromBlock: head - BigInt((blocks ?? 90) - 1),
        toBlock: head,
      });
      const qd = await decimals(m.quote);
      const bd = await decimals(m.base);
      return text(
        logs
          .map((l) => l.args as { upToBlock: bigint; price: bigint; volume: bigint; refPrice: bigint; status: number })
          .filter((a) => a.volume > 0n)
          .map((a) => ({
            batch: a.upToBlock,
            price: formatUnitsExact(a.price, qd),
            volume: formatUnitsExact(a.volume, bd),
            reference: formatUnitsExact(a.refPrice, qd),
            status: statusName(a.status),
          })),
      );
    },
  );

  server.registerTool(
    "place_order",
    {
      description:
        "Place a limit order for the human account this agent trades for (signed with the session key, relayed gaslessly). " +
        "It executes in the next batch at the uniform clearing price, never worse than the limit. Caps set by the human apply.",
      inputSchema: {
        symbol: z.string(),
        side: z.enum(["buy", "sell"]),
        price: z.string().describe('limit price in quote units, e.g. "180.25"'),
        qty: z.string().describe('base quantity, e.g. "1.5"'),
        ioc: z.boolean().optional().describe("immediate-or-cancel: drop any remainder after its first auction"),
      },
    },
    async ({ symbol, side, price, qty, ioc }) => {
      if (!agentKey || !agentAccount || !deployment.gateway) {
        throw new Error("trading needs AGENT_PRIVATE_KEY, AGENT_ACCOUNT and a deployment with a gateway");
      }
      const m = market(symbol);
      const s = await client.market(BigInt(m.id));
      const [qd, bd] = [await decimals(m.quote), await decimals(m.base)];
      const isBuy = side === "buy";
      const order = buildOrder({
        account: agentAccount,
        marketId: BigInt(m.id),
        side: isBuy ? Side.BID : Side.ASK,
        tick: tickOfPrice(parseUnitsExact(price, qd), s.tickSize, isBuy ? "down" : "up"),
        qty: parseUnitsExact(qty, bd),
        ioc: ioc ?? false,
        ttlSeconds: 120,
      });
      const sig = await signAsSession(agentKey, deployment.chainId, deployment.gateway, order);
      const r = await fetch(`${relayer}/v1/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(orderToJson(order, sig)),
      });
      return text({ httpStatus: r.status, ...((await r.json()) as object) });
    },
  );

  server.registerTool(
    "cancel_order",
    {
      description:
        "Cancel one of the account's orders by slot (see my_orders), signed with the session key and relayed gaslessly. " +
        "Its locked funds are released; anything already filled stays filled.",
      inputSchema: { slot: z.number().int().min(0).describe("the order's slot, from my_orders") },
    },
    async ({ slot }) => {
      if (!agentKey || !agentAccount || !deployment.gateway) {
        throw new Error("cancelling needs AGENT_PRIVATE_KEY, AGENT_ACCOUNT and a deployment with a gateway");
      }
      const cancel = buildCancel({ account: agentAccount, slot });
      const sig = await signAsSession(agentKey, deployment.chainId, deployment.gateway, cancel, "Cancel");
      try {
        return text(await new RelayerClient(relayer).postCancel(cancel, sig));
      } catch (e) {
        return text({ error: (e as Error).message });
      }
    },
  );

  server.registerTool(
    "order_status",
    { description: "Status of a relayed order (queued, sent, done, failed).", inputSchema: { id: z.string() } },
    async ({ id }) => text(await (await fetch(`${relayer}/v1/orders/${id}`)).json()),
  );

  server.registerTool(
    "my_orders",
    { description: "Open orders of the account this agent trades for, with fills so far." },
    async () => {
      if (!agentAccount) throw new Error("AGENT_ACCOUNT not set");
      const slots = await client.openSlots(agentAccount);
      const out = [];
      for (const slot of slots) {
        const [o, p] = await Promise.all([client.order(agentAccount, slot), client.previewOrder(agentAccount, slot)]);
        out.push({ slot, market: o.market, side: o.side === 0n ? "buy" : "sell", tick: o.tick, qty: o.qty, ...p });
      }
      return text(out);
    },
  );

  server.registerTool(
    "vault",
    {
      description: "The market's LiquidityVault: inventory, pending LP requests and on-chain P&L attribution.",
      inputSchema: { symbol: z.string() },
    },
    async ({ symbol }) => {
      const m = market(symbol);
      if (!m.vault) throw new Error(`${symbol} has no vault`);
      const v = await client.vault(m.vault);
      const [qd, bd] = [await decimals(m.quote), await decimals(m.base)];
      return text({
        base: formatUnitsExact(v.baseBalance, bd),
        quote: formatUnitsExact(v.quoteBalance, qd),
        spreadPnl: formatUnitsExact(v.spreadPnl, qd),
        inventoryPnl: formatUnitsExact(v.inventoryPnl, qd),
        pendingRequests: v.pendingRequests,
      });
    },
  );

  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
