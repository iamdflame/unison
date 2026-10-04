"use client";

import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/lib/store/createStore";
import { identity } from "@/lib/venue/identity";
import { useVenue, useVenueAccount } from "@/lib/venue";
import { SignIn } from "./SignIn";

/** You: sign in (live), or your free AUSD (signed in, or the simulation's paper account). */
export function AccountButton() {
  const v = useVenue();
  const id = useStore(identity, (x) => x);
  const quote = useVenueAccount((a) => a.quote);
  const [open, setOpen] = useState(false);
  const signedOut = v.mode === "live" && !id;
  const paper = v.ready && v.mode === "demo";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-bg sm:min-h-10"
        aria-label={signedOut ? "Sign in" : paper ? `Paper account: ${quote.toFixed(2)} AUSD, simulated` : `Account: ${quote.toFixed(2)} AUSD available`}
      >
        {paper ? (
          <span className="rounded-full bg-bg/20 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase">Paper</span>
        ) : (
          <Fingerprint size={15} strokeWidth={1.6} aria-hidden />
        )}
        {signedOut ? (
          "Sign in"
        ) : (
          <>
            <span className="figures">{quote.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            <span className="hidden opacity-70 sm:inline">AUSD</span>
          </>
        )}
      </button>
      <SignIn open={open} onOpenChange={setOpen} />
    </>
  );
}
