"use client";

import { createStore } from "../store/createStore.ts";

/**
 * The guided tour of the terminal. `invited` shows the small card that offers it (once, on a first visit); `queued`
 * asks for it, and it runs as soon as the terminal is on screen (a replay from ⌘K on another page navigates there
 * first); `running` shows the tour itself, at `step`. Finishing it or declining it is remembered in this browser, so
 * the invitation never comes back; the tour itself can always be replayed (⌘K, or "Take the tour" on the terminal).
 */
export type TourStatus = "idle" | "invited" | "queued" | "running";
export interface TourState {
  status: TourStatus;
  step: number;
}

export const TOUR_KEY = "unison.tour.v1";
export const tour = createStore<TourState>({ status: "idle", step: 0 });

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;
const local = (): Storage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // blocked site data throws on access itself
  }
};

/**
 * Whether this browser has finished or declined the tour. Storage that can't be read counts as seen: an invitation
 * that could never be dismissed would come back on every visit.
 */
export function tourSeen(store: Reader | undefined = local()): boolean {
  try {
    return store ? store.getItem(TOUR_KEY) !== null : true;
  } catch {
    return true;
  }
}

export function rememberTour(outcome: "done" | "dismissed", store: Writer | undefined = local()) {
  try {
    store?.setItem(TOUR_KEY, outcome);
  } catch {
    // nothing to keep it in: the tour simply isn't remembered
  }
}

/** Offers the tour, unless it is already offered or running. */
export const inviteTour = () => tour.set((t) => (t.status === "idle" ? { status: "invited", step: 0 } : t));
/** Asks for the tour from the first stop; the host runs it once the terminal is on screen. */
export const startTour = () => tour.set({ status: "queued", step: 0 });
export const goToStep = (step: number) => tour.set((t) => (t.status === "running" && t.step !== step ? { ...t, step } : t));
/** Ends the tour or the invitation: `done` after the last step, `dismissed` for Skip, Esc or "Not now". */
export function endTour(outcome: "done" | "dismissed") {
  rememberTour(outcome);
  tour.set({ status: "idle", step: 0 });
}
