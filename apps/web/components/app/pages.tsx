"use client";

import dynamic from "next/dynamic";

/**
 * The app's live pages render on the client only: they read clocks, simulations and the venue, none of which
 * the server can know. Each one holds its exact place with a skeleton until it arrives.
 */
function Skeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div className="mx-auto max-w-[1280px] animate-pulse px-4 py-8 motion-reduce:animate-none sm:px-6 lg:py-12" aria-busy="true" aria-label={label}>
      <div className="h-11 w-48 rounded-2xl bg-sunken" />
      <div className="mt-4 h-5 w-80 max-w-full rounded-xl bg-sunken" />
      <div className="mt-8 rounded-[var(--radius-xl)] bg-raised shadow-md" style={{ height: 56 + rows * 68 }} />
    </div>
  );
}

export const MarketsClient = dynamic(() => import("./MarketsBoard").then((m) => m.MarketsBoard), {
  ssr: false,
  loading: () => <Skeleton rows={10} label="Loading markets" />,
});

export const PortfolioClient = dynamic(() => import("@/components/portfolio/Portfolio").then((m) => m.Portfolio), {
  ssr: false,
  loading: () => <Skeleton rows={6} label="Loading your portfolio" />,
});

export const AgentsClient = dynamic(() => import("@/components/agents/Agents").then((m) => m.Agents), {
  ssr: false,
  loading: () => <Skeleton rows={5} label="Loading agents" />,
});

export const VaultsClient = dynamic(() => import("@/components/vaults/Vaults").then((m) => m.VaultIndex), {
  ssr: false,
  loading: () => <Skeleton rows={6} label="Loading vaults" />,
});

export const VaultDetailClient = dynamic(() => import("@/components/vaults/Vaults").then((m) => m.VaultDetail), {
  ssr: false,
  loading: () => <Skeleton rows={5} label="Loading the vault" />,
});

export const FairnessLiveClient = dynamic(() => import("@/components/fairness/FairnessLive").then((m) => m.FairnessLive), {
  ssr: false,
  loading: () => <div className="mx-auto h-[900px] max-w-[1440px]" aria-busy="true" aria-label="Loading the live record" />,
});

export const TapeConsoleClient = dynamic(() => import("@/components/developers/LivePieces").then((m) => m.TapeConsole), {
  ssr: false,
  loading: () => <div className="h-[25rem] rounded-[var(--radius-lg)] bg-sunken" aria-busy="true" />,
});

export const ContractsClient = dynamic(() => import("@/components/developers/LivePieces").then((m) => m.Contracts), {
  ssr: false,
  loading: () => <div className="h-48 rounded-[var(--radius-xl)] bg-raised shadow-md" aria-busy="true" />,
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
  loading: () => <div className="h-[640px] rounded-[var(--radius-xl)] bg-raised shadow-md" aria-busy="true" />,
});
