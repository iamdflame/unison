import type { ReactNode } from "react";

/**
 * The one mark for what something is not yet: testnet, paper, simulation, example. Small capitals in a hairline
 * box, the way a maison stamps a hallmark, in the same form wherever the site says it. Sentences that explain stay
 * sentences; this only names.
 */
export function Hallmark({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`dial-label inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-1 text-[10px] leading-none text-ink-3 hairline ${className}`}>
      {children}
    </span>
  );
}
