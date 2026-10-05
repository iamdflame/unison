import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";

export const metadata: Metadata = { title: "Privacy", description: "What Unison keeps, where, and what is public on-chain." };

export default function PrivacyPage() {
  return (
    <LegalPage
      path="/legal/privacy"
      title="Privacy"
      updated="October 5, 2026"
      intro={
        <p>
          Unison asks for no name, email or document. What it knows about you is what your browser keeps, what a public
          blockchain records, and what its services need to stop abuse.
        </p>
      }
      sections={[
        {
          id: "browser",
          title: "What stays in your browser",
          body: (
            <>
              <ul className="space-y-2">
                <li>
                  <strong>Your passkey identity:</strong> the credential&apos;s ID and public key, and the account address they
                  derive. Your passkey&apos;s private key never leaves your device&apos;s authenticator.
                </li>
                <li>
                  <strong>A trading session key,</strong> if you start one: kept for this tab only, and gone when it closes.
                </li>
                <li>
                  <strong>Your light and palette choices.</strong>
                </li>
              </ul>
              <p>No cookies are set, and the site loads no analytics or advertising scripts.</p>
            </>
          ),
        },
        {
          id: "chain",
          title: "What is public, by design",
          body: (
            <p>
              Everything your account does on-chain is public and permanent: registering a passkey (its public key),
              deposits, orders, fills, cancels, withdrawals, and the session keys you grant. The tape indexes this public
              data so the site can show it. Anyone can do the same.
            </p>
          ),
        },
        {
          id: "services",
          title: "What the services record",
          body: (
            <>
              <p>
                The relayer, which submits your signed actions so you pay no gas, records each action with the IP address
                that sent it. It uses them to rate-limit requests and the test-funds faucet.
              </p>
              <p>
                The hosting providers that run this site and the services keep their own request logs under their own
                policies.
              </p>
            </>
          ),
        },
        {
          id: "sharing",
          title: "Who it is shared with",
          body: <p>No one, beyond what is public on-chain by design. Nothing is sold.</p>,
        },
        {
          id: "choices",
          title: "Your choices",
          body: (
            <p>
              Signing out removes your passkey identity from this browser. Clearing the site&apos;s storage removes
              everything it kept. On-chain records can&apos;t be erased, by anyone.
            </p>
          ),
        },
      ]}
    />
  );
}
