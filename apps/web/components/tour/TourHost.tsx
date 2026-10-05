"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useStore } from "@/lib/store/createStore";
import { preloadable, whenIdle } from "@/lib/ui/lazy";
import { endTour, inviteTour, tour, tourSeen } from "@/lib/ui/tour";
import { venue } from "@/lib/venue";

const Tour = preloadable(() => import("./Tour").then((m) => m.Tour));
const TourInvite = preloadable(() => import("./TourInvite").then((m) => m.TourInvite));

/**
 * Holds the guided tour's place. On a first visit to the terminal it offers the tour, once the venue is known and
 * nothing else is open; the tour runs when asked for, on the terminal only. Both are fetched while the page is idle,
 * and only for a visitor who hasn't seen the tour.
 */
export function TourHost() {
  const status = useStore(tour, (t) => t.status);
  const ready = useStore(venue, (v) => v.ready);
  const onTrade = (usePathname() ?? "").startsWith("/trade/");

  useEffect(() => {
    if (!onTrade || !ready || tourSeen()) return;
    whenIdle(() => {
      TourInvite.preload();
      Tour.preload();
    });
    let timer = 0;
    const offer = () => {
      if (tour.get().status !== "idle") return;
      // never over a sheet or a dialog (the sign-in a passkey link opens): offer it once that closes
      if (document.querySelector('[role="dialog"]')) timer = window.setTimeout(offer, 1000);
      else inviteTour();
    };
    timer = window.setTimeout(offer, 1200);
    return () => clearTimeout(timer);
  }, [onTrade, ready]);

  // asked for (from the invitation, the terminal, or ⌘K on another page): it runs once the terminal is on screen,
  // and leaving the terminal ends it
  useEffect(() => {
    if (status === "queued" && onTrade) tour.set({ status: "running", step: 0 });
    else if (status === "running" && !onTrade) endTour("dismissed");
  }, [status, onTrade]);

  if (!onTrade) return null;
  return status === "running" ? (
    <Suspense fallback={null}>
      <Tour />
    </Suspense>
  ) : status === "invited" ? (
    <Suspense fallback={null}>
      <TourInvite preload={Tour.preload} />
    </Suspense>
  ) : null;
}
