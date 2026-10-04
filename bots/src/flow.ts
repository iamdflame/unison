/**
 * House flow for devnet and testnet. A few funded trader accounts quote both sides around the reference every few
 * blocks and, now and then, cross the spread, so a live venue prints real trades for demos and dashboards. This is
 * team liquidity on test networks, never on mainnet, and it is labelled as such wherever it shows.
 *
 *   RPC_URL=http://127.0.0.1:8546 DEPLOYMENT=../deployments/31337.json pnpm --filter @unison/bots flow
 *
 * Env: RPC_URL, DEPLOYMENT, RELAY_URL (reference prices; default http://127.0.0.1:8787), TRADER_KEYS (comma-separated;
 * default: the devnet's anvil traders), EVERY_BLOCKS (3), CROSS_P (0.35), MAX_OPEN (20 per account)
 */
import { chainById, Side, UnisonClient, unisonExchangeAbi, type Deployment } from "@unison/sdk";
import { loadDeploymentFile } from "@unison/sdk/node";
import { createPublicClient, createWalletClient, erc20Abi, http, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

// anvil's default keys #3–#5: trader1..3 in deployments/31337.json (public test keys, devnet only)
const DEVNET_TRADERS: Hex[] = [
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];

async function main() {
  const deployment: Deployment = await loadDeploymentFile(env("DEPLOYMENT", "../deployments/31337.json"));
  if (deployment.chainId === 143) throw new Error("house flow never runs on mainnet");
  const chain = chainById(deployment.chainId);
  const transport = http(env("RPC_URL", chain.rpcUrls.default.http[0]));
  const publicClient = createPublicClient({ chain, transport });
  const relay = env("RELAY_URL", "http://127.0.0.1:8787");
  const every = Number(env("EVERY_BLOCKS", "3"));
  const crossP = Number(env("CROSS_P", "0.35"));
  const maxOpen = Number(env("MAX_OPEN", "20"));
  const keys = (process.env.TRADER_KEYS?.split(",") as Hex[] | undefined) ?? (deployment.chainId === 31337 ? DEVNET_TRADERS : []);
  if (keys.length < 2) throw new Error("need at least two TRADER_KEYS");

  const traders = keys.map((k) => {
    const account = privateKeyToAccount(k);
    const walletClient = createWalletClient({ chain, transport, account });
    return { account, client: new UnisonClient({ publicClient: publicClient as never, walletClient: walletClient as never, deployment }) };
  });

  // Fund the venue ledger once: deposit most of each token the trader holds.
  const tokens = Object.values(deployment.tokens ?? {});
  for (const t of traders) {
    for (const tok of tokens) {
      const inLedger = await t.client.balanceOf(t.account.address, tok.address as Address).catch(() => 0n);
      if (inLedger > 0n) continue;
      const held = await publicClient.readContract({ address: tok.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [t.account.address] });
      if (held === 0n) continue;
      const h = await t.client.approveAndDeposit(tok.address as Address, (held * 9n) / 10n);
      await publicClient.waitForTransactionReceipt({ hash: h });
      console.log(JSON.stringify({ msg: "deposited", trader: t.account.address, token: tok.symbol }));
    }
  }

  const markets = Object.values(deployment.markets);
  const open = new Map<string, bigint[]>(); // trader → slots, oldest first
  let last = 0n;
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  console.log(JSON.stringify({ msg: "house flow up", traders: traders.map((t) => t.account.address), markets: markets.map((m) => m.symbol) }));
  for (;;) {
    const head = await publicClient.getBlockNumber();
    if (head - last < BigInt(every)) {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    last = head;
    const prices = (await fetch(`${relay}/prices`).then((r) => r.json()).catch(() => ({}))) as Record<string, { marketId: string; price: string }>;
    for (const m of markets) {
      const ref = prices[m.symbol];
      if (!ref) continue;
      const { tickSize, baseUnit } = await traders[0]!.client.marketPricing(BigInt(m.id));
      const refTick = Number(BigInt(ref.price) / tickSize);
      const spread = Math.max(2, Math.round(refTick * 0.0008));
      const cross = Math.random() < crossP;
      const maker = traders[Math.floor(Math.random() * traders.length)]!;
      const taker = traders.find((t) => t !== maker) ?? maker;
      const qty = (lots: number) => (BigInt(Math.round(lots * 100)) * baseUnit) / 100n;
      const orders: { who: (typeof traders)[number]; side: 0 | 1; tick: number; q: bigint }[] = [
        { who: maker, side: Side.BID, tick: refTick - Math.round(rand(1, spread)), q: qty(rand(0.5, 3)) },
        { who: maker, side: Side.ASK, tick: refTick + Math.round(rand(1, spread)), q: qty(rand(0.5, 3)) },
      ];
      if (cross) {
        const buy = Math.random() < 0.5;
        orders.push({ who: taker, side: buy ? Side.BID : Side.ASK, tick: refTick + (buy ? spread * 2 : -spread * 2), q: qty(rand(0.3, 2)) });
      }
      for (const o of orders) {
        try {
          const key = o.who.account.address;
          const slots = open.get(key) ?? [];
          if (slots.length >= maxOpen) {
            const oldest = slots.shift()!;
            await o.who.client.cancelOrder(oldest).catch(() => undefined);
          }
          const hash = await o.who.client.placeOrder({ marketId: BigInt(m.id), side: o.side, tick: BigInt(o.tick), qty: o.q, ioc: cross && o === orders[2] });
          const rcpt = await publicClient.waitForTransactionReceipt({ hash });
          const [placed] = parseEventLogs({ abi: unisonExchangeAbi, logs: rcpt.logs, eventName: "OrderPlaced" });
          if (placed) slots.push((placed.args as { slot: bigint }).slot);
          open.set(key, slots);
        } catch (e) {
          console.log(JSON.stringify({ msg: "order failed", market: m.symbol, error: (e as Error).message.split("\n")[0] }));
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
