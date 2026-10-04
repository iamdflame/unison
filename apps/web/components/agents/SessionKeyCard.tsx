import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A session key as an object: who it is, what it may do, until when. One card wherever a key is shown (a key you
 * hold on the Agents page, the example on the home page), so a key always looks like the same thing. Presentational
 * only: the caller formats the values and brings the badge and the action.
 */
export function SessionKeyCard({
  address,
  markets,
  expires,
  size,
  notional,
  badge,
  action,
  label,
  className = "",
}: {
  /** shortened for display: 0x8c3e…41d2 */
  address: string;
  markets: string;
  expires: string;
  size: string;
  notional: string;
  badge?: ReactNode;
  action?: ReactNode;
  /** the card's accessible name */
  label?: string;
  className?: string;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel sm:p-7 ${className}`}
      aria-label={label ?? `Session key ${address}`}
    >
      <div className="relative flex items-center justify-between gap-3">
        <span className="dial-label text-ink-3">Session key</span>
        {badge}
      </div>
      <p className="relative mt-4 font-mono text-[15px] text-ink">{address}</p>
      <dl className="relative mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div>
          <dt className="text-ink-3">Markets</dt>
          <dd className="mt-0.5 text-ink">{markets}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Expires</dt>
          <dd className="figures mt-0.5 text-ink">{expires}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Units per order</dt>
          <dd className="figures mt-0.5 text-ink">{size}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Notional per order</dt>
          <dd className="figures mt-0.5 text-ink">{notional}</dd>
        </div>
        {/* the limits are per order: say what that means for the total, plainly */}
        <div className="col-span-2">
          <dt className="text-ink-3">In total</dt>
          <dd className="mt-0.5 text-ink">Not capped: any number of orders, as far as your free balance goes, until it expires.</dd>
        </div>
      </dl>
      <div className="relative mt-6 flex items-center justify-between gap-4 border-t border-line pt-4">
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <LockKeyhole size={15} strokeWidth={1.6} aria-hidden /> Places and cancels. Can never withdraw.
        </p>
        {action}
      </div>
    </article>
  );
}
