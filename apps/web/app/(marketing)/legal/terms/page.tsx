import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/LegalPage";

export const metadata: Metadata = { title: "Terms", description: "The terms for using Unison: a draft, in plain language." };

export default function TermsPage() {
  return (
    <LegalPage
      path="/legal/terms"
      title="Terms of use"
      updated="October 6, 2026"
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
                Unison runs a frequent batch auction: every order in a market clears at one price, inside a band. Orders
                are sealed in the block they land in (about 300 ms), and in session each auction&apos;s band is centred on a
                reference price observed after its orders were sealed; while the reference market is closed, on its last
                price. On the mainnet beta an auction runs at each Chainlink observation that finds orders waiting
                (typically half a minute for MON, longer for stocks outside US market hours); on the testnet and in the
                simulation, every block while the reference market trades. While it is closed, a call auction runs every
                10 blocks (about 3 seconds).
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
          title: "The mainnet beta and the test networks",
          body: (
            <>
              <p>
                <strong>On Monad mainnet, Unison is a beta with real assets and real money.</strong> It lists Anchored&apos;s
                tokenized NVIDIA (aNVDA) and wrapped MON against Agora&apos;s AUSD. Prices come from Chainlink feeds. The
                vaults are small and every market has a daily volume cap. The contracts are{" "}
                <strong>not yet externally audited</strong>: deposit only what you can afford to lose.
              </p>
              <p>
                One market, <strong>WMON/AUSD (old rule)</strong>, is kept on purpose on the rule Unison replaced: it
                clears against Chainlink&apos;s latest price at the moment of the clear, so a faster trader can trade
                against a price they already know. It exists as the control for the{" "}
                <Link href="/challenge">standing challenge</Link>, whose contracts alone decide who is paid.
              </p>
              <p>
                On the Monad testnet and local devnets, every token, including AUSD and the tokenized stocks, is a{" "}
                <strong>mock with no value</strong>, issued by test faucets. Prices there follow reference feeds or a
                simulator, and are not offers to buy or sell anything.
              </p>
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
                A limit order fills at its auction&apos;s uniform price, never worse than your limit, and only inside the
                auction&apos;s band. It may fill in part, across several auctions, or not at all. On the mainnet
                beta&apos;s markets every order is for one auction: it is sealed, and can&apos;t be cancelled, until that
                auction runs, and what doesn&apos;t fill comes back to you. While a market is halted no auction runs:
                waiting orders come back unfilled, and you can still cancel resting orders, claim and withdraw. While the
                exchange is paused, waiting orders stay sealed until it resumes; withdrawals still work.
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
