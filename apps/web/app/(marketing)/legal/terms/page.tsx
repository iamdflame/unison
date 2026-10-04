import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/LegalPage";

export const metadata: Metadata = { title: "Terms", description: "The terms for using Unison: a draft, in plain language." };

export default function TermsPage() {
  return (
    <LegalPage
      path="/legal/terms"
      title="Terms of use"
      updated="October 4, 2026"
      intro={
        <p>
          Unison is software: smart contracts on Monad and the services and website around them. These terms cover using
          this website and those services. By using them you agree to what follows.
        </p>
      }
      sections={[
        {
          id: "what",
          title: "What Unison is, and isn't",
          body: (
            <>
              <p>
                Unison runs a frequent batch auction: every 300 ms, every order in a market clears at one price, inside a
                band around a reference price published after the batch closed.
              </p>
              <p>
                Unison is not a broker, an adviser or a custodian. It doesn&apos;t hold your funds; the contracts do, under
                rules anyone can read. Nothing on this site is investment, legal or tax advice.
              </p>
            </>
          ),
        },
        {
          id: "test",
          title: "Test networks and mock assets",
          body: (
            <>
              <p>
                Today Unison runs on a local devnet and the Monad testnet. Every token there, including AUSD and the
                tokenized stocks, is a <strong>mock with no value</strong>, issued by test faucets. A future mainnet
                launch will come with its own terms.
              </p>
              <p>Prices on test networks follow reference feeds or a simulator. They are not offers to buy or sell anything.</p>
            </>
          ),
        },
        {
          id: "eligibility",
          title: "Who may use it",
          body: (
            <>
              <p>
                Tokenized stocks are <strong>not available to US persons</strong> or to anyone in a place where offering
                them would be unlawful. You are responsible for knowing whether using Unison is legal where you are.
              </p>
              <p>You must be old enough to enter a binding agreement where you live.</p>
            </>
          ),
        },
        {
          id: "account",
          title: "Your account and your keys",
          body: (
            <>
              <p>
                Your account is your passkey. Unison never sees your passkey&apos;s private key; your device keeps it. If you
                lose every device that holds it, no one, including us, can sign for that account.
              </p>
              <p>
                Session keys you grant can place and cancel orders within the limits you set, until they expire or you
                revoke them. They can never withdraw. You are responsible for every key you grant and for anything signed
                with your passkey.
              </p>
            </>
          ),
        },
        {
          id: "orders",
          title: "Orders and fills",
          body: (
            <>
              <p>
                A limit order fills at its batch&apos;s uniform price, never worse than your limit, and only inside the
                batch&apos;s band. It may fill in part, across several batches, or not at all. While a market is halted,
                no auction runs; you can still cancel, claim and withdraw.
              </p>
              <p>
                The contract&apos;s state is the record. This site, the tape and the relayer show it; if they ever disagree
                with the chain, the chain is right.
              </p>
            </>
          ),
        },
        {
          id: "software",
          title: "Software, as is",
          body: (
            <p>
              Unison is provided as is, without warranties of any kind. The contracts are{" "}
              <strong>not yet externally audited</strong>. Services may be slow, stop, or change. Read{" "}
              <Link href="/legal/risk">the risks</Link> before relying on any of it.
            </p>
          ),
        },
        {
          id: "liability",
          title: "Limits of liability",
          body: (
            <p>
              To the fullest extent the law allows, the people who build and run Unison aren&apos;t liable for losses from
              using it, including losses caused by bugs, outages, price moves, network failures or lost keys.
            </p>
          ),
        },
        {
          id: "changes",
          title: "Changes",
          body: <p>These terms will change as Unison moves toward mainnet. The date above says when they last did.</p>,
        },
      ]}
    />
  );
}
