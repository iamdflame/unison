"use client";

import { Suspense, useState } from "react";
import { preloadable } from "@/lib/ui/lazy";

const Sheet = preloadable(() => import("./SignIn").then((m) => m.SignIn));

/** Starts fetching the sheet when a sign-in looks near (a pointer over the button, focus on it). */
export const preloadSignIn = Sheet.preload;

/** The sign-in sheet (passkeys, a trading session, test funds), fetched the first time it is wanted. */
export function SignInSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return mounted ? (
    <Suspense fallback={null}>
      <Sheet open={open} onOpenChange={onOpenChange} />
    </Suspense>
  ) : null;
}
