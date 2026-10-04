import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ContractsClient, TapeConsoleClient } from "@/components/app/pages";
import { VenueBoot } from "@/components/app/VenueBoot";
import { Code } from "@/components/code/Code";
import { site } from "@/lib/content/site";

export const metadata: Metadata = {
  title: "Developers",
  description: "Build on one price: the Unison SDK, the clearing engine bit-exact with the contracts, a gasless relayer, the tape and its live stream, and an MCP server for agents.",
};

function Chapter({ id, title, lede, children, aside }: { id: string; title: string; lede: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id={id} className="text-display-l text-ink">
            {title}
          </h2>
          <div className="text-lede mt-5 text-ink-2">{lede}</div>
          {aside}
        </div>
        <div className="min-w-0 lg:col-span-7">{children}</div>
      </div>
    </section>
  );
}

const TAPE = `import { TapeClient } from "@unison/sdk";

const tape = new TapeClient(TAPE_URL);

// one uniform price per batch, as it clears
tape.stream(["prints:0"], {
  print: (p) => console.log(p.upTo, p.price, p.deviationBps, p.receiptHash),
});

// or ask: last prints, candles, fairness, an account's orders and fills
const fairness = await tape.fairness(0, { window: "24h" });`;

const TRADE = `import { buildOrder, RelayerClient, Side, signAsSession, tickOfPrice } from "@unison/sdk";

const order = buildOrder({
  account,                         // the account this key trades for
  marketId: 0n,                    // aNVDA/AUSD
  side: Side.BID,
  tick: tickOfPrice(180_250_000n, 10_000n), // $180.25, never worse
  qty: 10n ** 18n,                 // 1 share
});
const sig = await signAsSession(sessionKey, chainId, gateway, order);
const { id } = await new RelayerClient(RELAYER_URL).postOrder(order, sig); // no gas`;

const ENGINE = `import { compute } from "@unison/engine";

// the batch now forming, per tick in the band (from depth + pending orders)
const r = compute({ lo, hi, refTick, bidAbove, askBelow, bids, asks });

r.traded;  // did demand meet supply inside the band?
r.tick;    // the one price everyone in the batch gets
r.volume;  // and how much changed hands`;

const CHAIN = `import { encodeAbiParameters, keccak256 } from "viem";

const T = ["bytes32", "uint256", "uint64", "uint256", "uint256", "uint256", "uint64", "uint8", "uint256"]
  .map((type) => ({ type }));

let prev = "0x" + "0".repeat(64);
for (const p of (await tape.prints(0, { limit: 1000 })).reverse()) {
  const h = keccak256(encodeAbiParameters(T, [prev, 0n, BigInt(p.upTo), BigInt(p.tick), BigInt(p.volume),
    BigInt(p.refPrice), BigInt(p.refTimeMs), p.status, BigInt(p.ts / 1000)]));
  if (p.prevReceiptHash === prev && h !== p.receiptHash) throw new Error(\`batch \${p.upTo} doesn't recompute\`);
  prev = p.receiptHash;
}`;

const MCP = `claude mcp add unison \\
  -e DEPLOYMENT=deployments/monad-testnet.json \\
  -e RELAYER_URL=$RELAYER_URL -e RPC_URL=$RPC_URL \\
  -e AGENT_ACCOUNT=0x… -e AGENT_PRIVATE_KEY=0x… \\
  -- node --conditions=development services/mcp/src/main.ts`;

const SURFACE: [string, [string, string][]][] = [
  [
    "Tape (read)",
    [
      ["GET /v1/markets", "every market: reference, regime, last print, 24 h volume"],
      ["GET /v1/markets/:id/prints", "uniform prints, newest first; .csv for all of them"],
      ["GET /v1/markets/:id/fairness", "distance from the reference, reference lag, chain check"],
      ["GET /v1/accounts/:addr/orders", "orders with per-auction fills at each batch's price"],
      ["GET /v1/receipts/:market/:account/:slot", "a fill's receipt, recomputed"],
      ["GET /v1/stream", "SSE: heads, prints, regime, account:0x…"],
    ],
  ],
  [
    "Relayer (write, no gas)",
    [
      ["POST /v1/orders", "a signed order: session key, passkey or wallet"],
      ["POST /v1/cancels", "a signed cancel"],
      ["POST /v1/withdrawals", "the account's own signature only"],
      ["POST /v1/sessions", "grant or revoke a key, with caps"],
      ["POST /v1/passkeys", "register a passkey account"],
      ["GET /v1/jobs/:id", "where a relayed action is"],
    ],
  ],
];

export default function DevelopersPage() {
  return (
    <>
      <section className="mx-auto max-w-[1440px] px-5 pt-36 pb-4 sm:px-8 lg:px-12 lg:pt-44">
        <h1 className="text-display-xl max-w-4xl text-ink">Build on one price.</h1>
        <p className="text-lede mt-7 max-w-2xl text-ink-2">
          A TypeScript SDK, the clearing engine bit-exact with the contracts, a gasless relayer, the tape and its live
          stream, and an MCP server for agents. Everything Unison runs on, open.
        </p>
      </section>

      <Chapter
        id="tape-title"
        title="Watch the tape."
        lede="Every batch, every market, as it clears: one uniform price, the reference it cleared on, the band, and the receipt hash that chains it to the last."
        aside={<div className="mt-8"><Code code={TAPE} title="stream.ts" /></div>}
      >
        <TapeConsoleClient />
      </Chapter>

      <Chapter id="trade-title" title="Trade from code." lede="Sign an order with a session key and the relayer submits it. Speed buys nothing here, so a script is as good as a desk.">
        <Code code={TRADE} title="order.ts" />
      </Chapter>

      <Chapter
        id="engine-title"
        title="Know the price before it prints."
        lede="@unison/engine is the auction itself, ported from Solidity integer for integer and diff-tested against it. Run the batch now forming and see the price it would clear at."
      >
        <Code code={ENGINE} title="indicative.ts" />
      </Chapter>

      <Chapter
        id="chain-title"
        title="Don't trust. Re-walk."
        lede={
          <>
            Each print commits to the one before it. Recompute the chain from the tape, or from the chain&apos;s own logs,
            and any rewritten batch stands out. <Link href="/fairness" className="text-ink underline decoration-line-strong underline-offset-4">The record</Link> does
            this live.
          </>
        }
      >
        <Code code={CHAIN} title="verify.ts" />
      </Chapter>

      <Chapter
        id="agents-title"
        title="Hand an agent the keys."
        lede={
          <>
            Mint a session key with limits on <Link href="/keys" className="text-ink underline decoration-line-strong underline-offset-4">Agents</Link>, then
            give it to any agent that speaks the Model Context Protocol. It can place and cancel within those limits, and can
            never withdraw.
          </>
        }
      >
        <Code code={MCP} lang="bash" title="Claude Code" />
      </Chapter>

      <section aria-labelledby="surface-title" className="border-t border-line">
        <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
          <h2 id="surface-title" className="text-display-l text-ink">
            The surface.
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {SURFACE.map(([title, rows]) => (
              <div key={title} className="overflow-hidden rounded-[var(--radius-xl)] bg-raised shadow-md">
                <p className="border-b border-line px-6 py-3.5 text-[15px] font-semibold text-ink">{title}</p>
                <dl className="divide-y divide-line">
                  {rows.map(([route, what]) => (
                    <div key={route} className="grid grid-cols-1 gap-1 px-6 py-3 text-sm sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:gap-4">
                      <dt className="font-mono text-[12.5px] text-ink">{route}</dt>
                      <dd className="text-ink-2">{what}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-ink-3">
            Every route, field and error code:{" "}
            <a href={`${site.repo}/blob/main/docs/API.md`} className="text-ink underline decoration-line-strong underline-offset-4">
              docs/API.md
            </a>
            .
          </p>

          <h2 className="text-display-m mt-20 text-ink">Contracts</h2>
          <div className="mt-6 max-w-3xl">
            <ContractsClient />
          </div>
        </div>
      </section>
      <VenueBoot />
    </>
  );
}
