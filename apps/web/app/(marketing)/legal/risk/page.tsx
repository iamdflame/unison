import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/LegalPage";
import { facts } from "@/lib/content/facts";

export const metadata: Metadata = { title: "Risk", description: "What can go wrong with Unison, said plainly." };

export default function RiskPage() {
  return (
    <LegalPage
      path="/legal/risk"
      title="Risks"
      updated="October 5, 2026"
      intro={
        <p>
          Unison removes one risk, being front-run by someone faster, and keeps all the others that come with trading. Read
          these before you rely on it.
        </p>
      }
      sections={[
        {
          id: "audit",
          title: "Unaudited contracts",
          body: (
            <p>
              The contracts are tested, fuzzed and diff-tested against an independent implementation, and they are{" "}
              <strong>not yet externally audited</strong>. A bug could lose funds.
            </p>
          ),
        },
        {
          id: "assets",
          title: "What a tokenized stock is",
          body: (
            <p>
              A tokenized stock is a token issued against shares held by an issuer or custodian. It isn&apos;t the share, and
              it may not carry a shareholder&apos;s rights. Its value depends on the issuer, the custodian and the rules they
              operate under. On the mainnet beta, aNVDA is Anchored&apos;s real token, backed by shares held with its US broker and custodian. On test networks the tokens are mocks with no value.
            </p>
          ),
        },
        {
          id: "nights",
          title: "Trading while Wall Street is closed",
          body: (
            <>
              <p>
                When the primary market is closed, Unison keeps trading in discovery: auctions every few blocks, inside a
                band that widens with the time since the close. Prices found then can be far from where the stock reopens.
                On {facts.weekend.nvdaMondaysGappedPct}% of Mondays in five years, NVIDIA opened more than {facts.weekend.gapThresholdPct}% away from Friday&apos;s close.
              </p>
              <p>When the primary market halts, Unison halts too, and only cancel, claim and withdraw work.</p>
            </>
          ),
        },
        {
          id: "reference",
          title: "The reference price",
          body: (
            <p>
              Each batch clears against a reference: a price signed by the venue&apos;s relay, or a Chainlink feed, checked
              against independent sources. A wrong or stale reference would mean wrong clearing prices, inside the band.
              The audit by Chainlink&apos;s CRE workflow, which halts a market that strays more than {facts.cre.haltAboveBps} bp, runs in simulation today.
            </p>
          ),
        },
        {
          id: "liquidity",
          title: "Liquidity",
          body: (
            <p>
              An order fills only if someone takes the other side inside the band. Each market&apos;s vault quotes around the
              reference within its limits and can be paused. Large orders may fill in part, or not at all.
            </p>
          ),
        },
        {
          id: "keys",
          title: "Keys and devices",
          body: (
            <p>
              Your passkey is your account. If every device that holds it is lost, so is access to the account. Anyone who
              holds a session key you granted can trade within its limits until it expires or you revoke it; it can never
              withdraw.
            </p>
          ),
        },
        {
          id: "network",
          title: "Networks and services",
          body: (
            <p>
              Unison depends on Monad, on RPC providers, and on its own keeper, relayer and tape. Any of them can be slow or
              stop. Your funds stay in the contracts when they do, and the contracts let you act without our services,
              directly from a wallet. <Link href="/status">Status</Link> shows them live.
            </p>
          ),
        },
        {
          id: "law",
          title: "Law and tax",
          body: (
            <p>
              Rules for tokenized securities differ by country and change. Tokenized stocks are not available to US persons.
              You are responsible for the law and the tax where you live.
            </p>
          ),
        },
      ]}
    />
  );
}
