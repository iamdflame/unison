import Link from "next/link";
import { SessionKeyCard } from "@/components/agents/SessionKeyCard";
import { Hallmark } from "@/components/ui/Hallmark";
import { AgentsTerminal } from "./AgentsTerminal";

/**
 * Chapter 7: built for agents, bounded by people. A real MCP session types itself out beside the session key that
 * bounds it: the same card the Agents page shows for a key you hold. Only the terminal runs on the client.
 */
export function Agents() {
  return (
    <section aria-labelledby="agents-title" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <div className="grid grid-cols-1 items-start gap-x-16 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <h2 id="agents-title" className="text-display-l text-ink">
            Built for agents.
            <br />
            Bounded by people.
          </h2>
          <p className="text-lede mt-6 text-ink-2">
            Inside a batch speed buys nothing, so software competes on judgement instead of latency. Give an agent a session key
            with the limits you choose: markets, size, notional and expiry. It can trade inside them. It can never
            withdraw.
          </p>
          <p className="mt-6 text-sm text-ink-3">Works with any MCP client, the TypeScript SDK, or plain signed messages.</p>
          <Link
            href="/keys"
            className="press mt-8 inline-flex items-center rounded-[var(--radius-sm)] px-5 py-3 text-[15px] font-semibold text-ink hairline"
          >
            Connect an agent
          </Link>
        </div>

        <div className="relative lg:col-span-6">
          <AgentsTerminal />
          {/* the key that bounds it, beneath the session it signed */}
          <SessionKeyCard
            className="mt-4 ml-auto w-[min(100%,420px)]"
            address="0x8c3e…41d2"
            label="Example session key 0x8c3e…41d2"
            markets="aNVDA, aSPY"
            expires="in 24 h"
            size="up to 10"
            notional="up to $5,000"
            badge={<Hallmark>Example</Hallmark>}
          />
        </div>
      </div>
    </section>
  );
}
