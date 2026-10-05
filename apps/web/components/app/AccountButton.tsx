"use client";

import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/lib/store/createStore";
import { signInRequests } from "@/lib/ui/signInRequest";
import { identity } from "@/lib/venue/identity";
import { useVenue, useVenueAccount } from "@/lib/venue";
import { preloadSignIn, SignInSheet } from "./SignInSheet";
import { Hallmark } from "@/components/ui/Hallmark";

/** You: sign in (live), or your free AUSD (signed in, or the simulation's paper account). */
export function AccountButton() {
  const v = useVenue();
  const id = useStore(identity, (x) => x);
  const quote = useVenueAccount((a) => a.quote);
  const [open, setOpen] = useState(false);
  // a page asked for the sheet (arriving from "Continue with a passkey"): open it once the venue is known, so it
  // shows the right thing (passkeys when live, the paper account in the simulation)
  const requests = useStore(signInRequests, (n) => n);
  const [answered, setAnswered] = useState(requests);
  if (requests !== answered && v.ready) {
    setAnswered(requests);
    setOpen(true);
  }
  const signedOut = v.mode === "live" && !id;
  const paper = v.ready && v.mode === "demo";
  return (
    <>
      <button
        type="button"
        data-tour="account"
        onClick={() => setOpen(true)}
        onPointerEnter={preloadSignIn}
        onFocus={preloadSignIn}
        // signing in is the one action; once in, the balance is quiet text (cash, in AUSD), marked by its hallmark
        className={`press inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-10 ${signedOut ? "rounded-[var(--radius-sm)] bg-ink px-4 font-semibold text-bg" : "rounded-[var(--radius-sm)] px-2.5 font-medium text-ink hover-fine:bg-ink/[0.05]"}`}
        aria-label={signedOut ? "Sign in" : paper ? `Paper account: ${quote.toFixed(2)} AUSD, simulated` : `Account: ${quote.toFixed(2)} AUSD available`}
      >
        {paper ? (
          <Hallmark>Paper</Hallmark>
        ) : (
          <Fingerprint size={15} strokeWidth={1.6} aria-hidden />
        )}
        {signedOut ? (
          "Sign in"
        ) : (
          <>
            <span className="figures">{quote.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            <span className="text-ink-3">AUSD</span>
          </>
        )}
      </button>
      <SignInSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
