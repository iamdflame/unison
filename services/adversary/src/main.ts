/**
 * The house adversary process (see bot.ts). Env:
 *   RPC_URL, DEPLOYMENT (deployments/monad-mainnet.json), ADVERSARY_PRIVATE_KEY,
 *   THRESHOLD_BPS (25: the WMON vaults' 20 bp spread plus the 3 bp fee, and a margin), QTY (10 WMON a leg),
 *   SLIPPAGE_BPS (50), SCORE_EVERY_SEC (600), DRY_RUN (0: 1 logs signals without trading), PORT (8793)
 *
 * GET /v1/score serves the latest scores (both pots, both accounts, every claim): public data, recomputable by anyone
 * from the chain with the SDK's scoreAccount, which is what this serves.
 *
 * The deployment names the two challenges (`challenge.unison`, `challenge.control`). On start the bot opens its account
 * in each if it has none; funding them is the operator's (apps/web/scripts/ops/challenge.mjs).
 */
import { createServer } from "node:http";
import { createPublicClient, createWalletClient, erc20Abi, http, nonceManager, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  chainById,
  challengeAccountAbi,
  chainlinkCausalReferenceAbi,
  latencyChallengeAbi,
  loadDeploymentFile,
  scoreAccount,
  challengeTerms,
} from "@unison/sdk";
import { Adversary, type Chain, type Leg } from "./bot.ts";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};
const log = (m: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), ...m }, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));

export async function startAdversary() {
  const deployment = await loadDeploymentFile(env("DEPLOYMENT", "../../deployments/monad-mainnet.json"));
  const ch = deployment.challenge as { unison: Address; control: Address } | undefined;
  if (!ch) throw new Error("the deployment names no challenge (deployment.challenge.unison / .control)");
  const chain = chainById(deployment.chainId);
  const transport = http(env("RPC_URL", chain.rpcUrls.default.http[0]), { timeout: 20_000 });
  // both legs go out at once: the nonce manager hands them consecutive nonces, so they land together
  const account = privateKeyToAccount(env("ADVERSARY_PRIVATE_KEY") as Hex, { nonceManager });
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, transport, account });
  const dry = env("DRY_RUN", "0") === "1";

  // Monad charges the gas limit: estimate, then a margin, never a blanket limit
  const send = async (address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]): Promise<Hex> => {
    const req = { address, abi, functionName, args, account } as never;
    const gas = ((await pub.estimateContractGas(req)) * 125n) / 100n;
    const hash = await wallet.writeContract({ ...(req as object), gas } as never);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
    return hash;
  };

  const legs: Leg[] = [];
  for (const [name, challenge] of [["unison", ch.unison], ["control", ch.control]] as const) {
    let acct = await pub.readContract({ address: challenge, abi: latencyChallengeAbi, functionName: "accountOf", args: [account.address] });
    if (acct === "0x0000000000000000000000000000000000000000") {
      await send(challenge, latencyChallengeAbi, "open", []);
      acct = await pub.readContract({ address: challenge, abi: latencyChallengeAbi, functionName: "accountOf", args: [account.address] });
      log({ action: "opened", leg: name, account: acct });
    }
    legs.push({ name, account: acct });
  }
  const terms = await challengeTerms(pub, ch.unison);

  const c: Chain = {
    latest: async () => {
      const [price, , , round] = await pub.readContract({
        address: terms.markout,
        abi: chainlinkCausalReferenceAbi,
        functionName: "latest",
        args: [terms.markoutMarketId],
      });
      return { price, round };
    },
    orderOpen: (a) => pub.readContract({ address: a, abi: challengeAccountAbi, functionName: "orderOpen" }),
    order: (a, side, tick, qty) => send(a, challengeAccountAbi, "order", [side, tick, qty]),
    settle: async (a) => {
      try {
        await pub.simulateContract({ address: a, abi: challengeAccountAbi, functionName: "settle", account });
      } catch {
        return false; // its auction hasn't run yet
      }
      await send(a, challengeAccountAbi, "settle", []);
      return true;
    },
  };
  const qty = parseUnits(env("QTY", "10"), 18);
  const bot = new Adversary({
    chain: dry ? { ...c, order: async () => "0x" as Hex } : c,
    legs,
    thresholdBps: Number(env("THRESHOLD_BPS", "25")),
    qty,
    tickSize: 1n,
    slippageBps: Number(env("SLIPPAGE_BPS", "50")),
  });

  // the exchange price: Coinbase's MON-USD ticker, Kraken's MON/USD as a second source
  const streams = [
    stream("coinbase", "wss://ws-feed.exchange.coinbase.com", { type: "subscribe", product_ids: ["MON-USD"], channels: ["ticker"] }, (m) =>
      m.type === "ticker" && typeof m.price === "string" ? Number(m.price) : null,
    ),
    stream("kraken", "wss://ws.kraken.com/v2", { method: "subscribe", params: { channel: "ticker", symbol: ["MON/USD"] } }, (m) => {
      const d = (m.data as { last?: number }[] | undefined)?.[0];
      return m.channel === "ticker" && typeof d?.last === "number" ? d.last : null;
    }),
  ];
  for (const s of streams) s.onPrice = (p) => void bot.onPrice(p);

  const settleTimer = setInterval(() => void bot.settle(), 3_000);
  // markout rounds never change once found: each fill is looked up once
  const caches = { unison: new Map<number, { base: bigint; quote: bigint }>(), control: new Map<number, { base: bigint; quote: bigint }>() };
  const board: { updatedAt: string | null; legs: Record<string, unknown>[] } = { updatedAt: null, legs: [] };
  const claims: Record<string, Hex> = {};
  const score = async () => {
    const out: Record<string, unknown>[] = [];
    for (const [name, challenge, leg] of [["unison", ch.unison, legs[0]!], ["control", ch.control, legs[1]!]] as const) {
      try {
        const s = await scoreAccount(pub, challenge, leg.account, undefined, caches[name]);
        log({ action: "score", leg: name, fills: s.fills.length, counted: s.counted, edge: s.edge, notional: s.notional, edgeBps: s.edgeBps, ready: s.ready, qualifies: s.qualifies });
        if (s.qualifies && !dry) {
          const tx = await send(challenge, latencyChallengeAbi, "claim", [leg.account, s.baseRounds, s.quoteRounds]);
          claims[name] = tx;
          log({ action: "claimed", leg: name, tx });
        }
        const [pot, paid] = await Promise.all([
          pub.readContract({ address: terms.pot, abi: erc20Abi, functionName: "balanceOf", args: [challenge] }),
          pub.readContract({ address: challenge, abi: latencyChallengeAbi, functionName: "paid" }),
        ]);
        out.push({
          name,
          challenge,
          account: leg.account,
          pot,
          paid,
          fills: s.fills.length,
          counted: s.counted,
          edge: s.edge,
          notional: s.notional,
          edgeBps: s.edgeBps,
          ready: s.ready,
          qualifies: s.qualifies,
          claimTx: claims[name] ?? null,
        });
      } catch (e) {
        log({ level: "warn", action: "score", leg: name, error: (e as Error).message.split("\n")[0] });
      }
    }
    if (out.length) {
      board.updatedAt = new Date().toISOString();
      board.legs = out;
    }
  };
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/v1/score")) {
      res.end(
        JSON.stringify(
          { adversary: account.address, thresholdBps: bot.cfg.thresholdBps, stats: bot.stats, ...board },
          (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
        ),
      );
    } else if (req.url === "/health") res.end('{"ok":true}');
    else {
      res.statusCode = 404;
      res.end('{"error":"NOT_FOUND"}');
    }
  });
  server.listen(Number(env("PORT", "8793")));
  const scoreTimer = setInterval(() => void score(), Number(env("SCORE_EVERY_SEC", "600")) * 1000);
  void score();
  log({ msg: "adversary up", address: account.address, legs, dry, thresholdBps: bot.cfg.thresholdBps, qty });
  return {
    bot,
    stop: () => {
      clearInterval(settleTimer);
      clearInterval(scoreTimer);
      server.close();
      for (const s of streams) s.close();
    },
  };
}

/** A reconnecting WebSocket price stream. */
function stream(name: string, url: string, subscribe: unknown, parse: (m: Record<string, unknown>) => number | null) {
  const s = { onPrice: (_p: number) => {}, close: () => {}, last: 0 };
  let ws: WebSocket | null = null;
  let closed = false;
  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => ws?.send(JSON.stringify(subscribe));
    ws.onmessage = (e) => {
      try {
        const p = parse(JSON.parse(String(e.data)) as Record<string, unknown>);
        if (p && p > 0) {
          s.last = p;
          s.onPrice(p);
        }
      } catch {
        /* not a ticker message */
      }
    };
    ws.onclose = () => {
      if (!closed) setTimeout(connect, 3_000);
    };
    ws.onerror = () => {
      log({ level: "warn", action: "stream", source: name, error: "socket error; reconnecting" });
      ws?.close();
    };
  };
  connect();
  s.close = () => {
    closed = true;
    ws?.close();
  };
  return s;
}

if (process.argv[1]?.endsWith("main.ts")) {
  startAdversary().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
