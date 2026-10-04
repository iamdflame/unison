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
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex items-center gap-2 rounded-full bg-ink px-3.5 py-2 text-sm font-semibold text-bg"
        aria-label={signedOut ? "Sign in" : `Account: ${quote.toFixed(2)} AUSD available`}
      >
        <Fingerprint size={15} strokeWidth={1.6} aria-hidden />
        {signedOut ? (
          "Sign in"
        ) : (
          <>
            <span className="tnum">{quote.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            <span className="opacity-70">AUSD</span>
          </>
        )}
      </button>
      <SignIn open={open} onOpenChange={setOpen} />
    </>
  );
}
