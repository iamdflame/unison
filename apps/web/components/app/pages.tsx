"use client";

import dynamic from "next/dynamic";

/**
 * Live islands on the marketing pages (fairness, developers, status, brand): they read clocks, simulations and the
 * venue, none of which the server can know, so they render on the client with a placeholder holding their place.
 * The app's own screens have one module each (screens/), so each can start its download early.
 */
export const FairnessLiveClient = dynamic(() => import("@/components/fairness/FairnessLive").then((m) => m.FairnessLive), {
  ssr: false,
  loading: () => <div className="mx-auto h-[900px] max-w-[1440px]" role="status" aria-busy="true" aria-label="Loading the live record" />,
});

export const TapeConsoleClient = dynamic(() => import("@/components/developers/LivePieces").then((m) => m.TapeConsole), {
  ssr: false,
  loading: () => <div className="h-[25rem] rounded-[var(--radius-lg)] bg-sunken" aria-busy="true" />,
});

export const ContractsClient = dynamic(() => import("@/components/developers/LivePieces").then((m) => m.Contracts), {
  ssr: false,
  loading: () => null,
});

export const StatusClient = dynamic(() => import("@/components/status/Status").then((m) => m.Status), {
  ssr: false,
  loading: () => <div className="mx-auto h-[700px] max-w-[1440px]" aria-busy="true" aria-label="Checking the venue" />,
});

export const StrikeMarkClient = dynamic(() => import("@/components/brand/BrandLive").then((m) => m.StrikeMark), {
  ssr: false,
  loading: () => <div className="mx-auto size-[268px]" aria-busy="true" />,
});

export const PaletteClient = dynamic(() => import("@/components/brand/BrandLive").then((m) => m.Palette), {
  ssr: false,
  loading: () => <div className="h-[640px] rounded-[var(--radius-xl)] bg-raised shadow-panel" aria-busy="true" />,
});
