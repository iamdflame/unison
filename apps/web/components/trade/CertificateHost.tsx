"use client";

import { Suspense, useEffect, useState } from "react";
import { useStore } from "@/lib/store/createStore";
import { preloadable, whenIdle } from "@/lib/ui/lazy";
import { certificate } from "./certificateStore";

const CertificateDialog = preloadable(() => import("./Certificate").then((m) => m.CertificateDialog));

/**
 * Holds the place of the certificate dialog. The engraved card (its frame, the brand drawing, the receipt check)
 * is fetched while the app is idle and mounted the first time a certificate opens; it then stays mounted, so it
 * can play its exit.
 */
export function CertificateHost() {
  const open = useStore(certificate, (c) => c !== null);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => whenIdle(CertificateDialog.preload), []);
  return mounted ? (
    <Suspense fallback={null}>
      <CertificateDialog />
    </Suspense>
  ) : null;
}
