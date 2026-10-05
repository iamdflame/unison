/** The terminal's exact shape while its market loads: a live market shows no price until the tape has sent one. */
export function TradeSkeleton() {
  return (
    <div className="mx-auto max-w-[1680px] animate-pulse px-4 py-5 motion-reduce:animate-none sm:px-6 lg:py-7" role="status" aria-busy="true" aria-label="Loading the market">
      <div className="h-6 w-48 rounded-full bg-sunken" />
      <div className="mt-3 h-12 w-64 rounded-2xl bg-sunken" />
      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="aspect-[900/470] rounded-[var(--radius-xl)] bg-raised shadow-panel" />
        <div className="h-[620px] rounded-[var(--radius-xl)] bg-raised shadow-panel" />
      </div>
    </div>
  );
}
