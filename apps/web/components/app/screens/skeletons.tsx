/** A screen's place, held until its code arrives (the app's live screens render on the client only). */
export function Skeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div className="mx-auto max-w-[1680px] animate-pulse px-4 py-8 motion-reduce:animate-none sm:px-6 lg:py-12" aria-busy="true" aria-label={label}>
      <div className="h-11 w-48 rounded-2xl bg-sunken" />
      <div className="mt-4 h-5 w-80 max-w-full rounded-xl bg-sunken" />
      <div className="mt-8 rounded-[var(--radius-xl)] bg-raised shadow-panel" style={{ height: 56 + rows * 68 }} />
    </div>
  );
}

/** The vault board alone, under the server-drawn title and lede: its measured height (ten 115 px rows on phones; a 66 px header and ten 75 px rows from md up). */
export function VaultBoardSkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" role="status" aria-busy="true" aria-label="Loading vaults">
      <div className="mt-2 h-5" />
      <div className="mt-8 h-[1149px] md:h-[815px] rounded-[var(--radius-xl)] bg-raised shadow-panel" />
    </div>
  );
}

/**
 * The markets board alone: the title and notes around it are already on screen, so its place is held exactly (the
 * board's measured height: ten 79 px rows on phones, a 41 px header and ten 77 px rows from md up) and the notes
 * below never move when it arrives.
 */
export function BoardSkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" role="status" aria-busy="true" aria-label="Loading markets">
      <div className="mt-3 h-12 sm:h-6">
        <div className="h-6 w-72 max-w-full rounded-xl bg-sunken" />
      </div>
      <div className="mt-1 h-5" />
      <div className="mt-8 h-[794px] rounded-[var(--radius-xl)] bg-raised shadow-panel md:h-[810px]" />
    </div>
  );
}
