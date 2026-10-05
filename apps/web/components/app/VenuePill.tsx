"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { useVenue } from "@/lib/venue";
import { chooseNetwork, networks, type Network } from "@/lib/venue/config";

const LONG: Record<Network, string> = { mainnet: "Monad mainnet", testnet: "Monad testnet", devnet: "Local devnet" };
const SHORT: Record<Network, string> = { mainnet: "Mainnet", testnet: "Testnet", devnet: "Devnet" };
const HINT: Record<Network, string> = {
  mainnet: "Real assets, Chainlink prices · beta, capped",
  testnet: "Practice: free test funds, mock assets",
  devnet: "This machine's chain",
};
// real money is marked as the movement marks its jewels; practice keeps the quiet verdigris
const LOOK: Record<Network, string> = {
  mainnet: "border border-champagne text-ink",
  testnet: "bg-buy-soft text-buy",
  devnet: "bg-buy-soft text-buy",
};
const DOT: Record<Network, string> = { mainnet: "bg-[var(--jewel)]", testnet: "bg-current", devnet: "bg-current" };
const ITEM = "flex cursor-default items-start gap-3 rounded-2xl px-3 py-2.5 outline-none select-none data-[highlighted]:bg-ink/[0.06]";

function Face({ n }: { n: Network }) {
  return (
    <>
      <span aria-hidden className={`size-1.5 rounded-full ${DOT[n]}`} />
      <span className="sm:hidden">{SHORT[n]}</span>
      <span className="hidden sm:inline">{LONG[n]}</span>
    </>
  );
}

/**
 * Says plainly where you are: which live network, or the simulation. Where the build knows two networks (mainnet and
 * the testnet), it is also the switch between them: each is its own venue, so switching reloads onto it.
 */
export default function VenuePill() {
  const v = useVenue();
  if (!v.ready) return null;
  const nets = networks();
  const live = v.mode === "live" && v.net ? v.net.network : null;
  // The simulation is named on the account pill ("Paper"); a single live network needs no menu.
  if (nets.length < 2) {
    if (!live) return null;
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1 text-xs font-semibold ${LOOK[live]}`} title={LONG[live]}>
        <Face n={live} />
      </span>
    );
  }
  const current = live ?? v.net?.network ?? nets[0]!;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Network: ${live ? LONG[live] : "simulation"}. Switch network`}
        className={`press inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1 text-xs font-semibold outline-none focus-visible:outline-2 focus-visible:outline-focus ${live ? LOOK[live] : "text-ink-2 hairline"}`}
      >
        {live ? <Face n={live} /> : <span>Simulation</span>}
        <ChevronDown size={12} strokeWidth={2} aria-hidden className="-mr-0.5 opacity-70" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={10} align="end" className="z-[60] outline-none">
          <Menu.Popup className="glass w-72 origin-[var(--transform-origin)] rounded-[22px] p-1.5 shadow-lg outline-none transition-[scale,opacity] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
            <Menu.Group>
              <Menu.GroupLabel className="px-3 pt-2 pb-1 text-xs font-medium text-ink-3">Network</Menu.GroupLabel>
              <Menu.RadioGroup value={current} onValueChange={(n) => n !== current && chooseNetwork(n as Network)}>
                {nets.map((n) => (
                  <Menu.RadioItem key={n} value={n} className={ITEM}>
                    <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${n === "mainnet" ? "bg-[var(--jewel)]" : "bg-buy"}`} />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-ink">{LONG[n]}</span>
                      <span className="block text-xs leading-snug text-ink-3">{HINT[n]}</span>
                    </span>
                    <Menu.RadioItemIndicator className="mt-0.5 text-accent">
                      <Check size={15} strokeWidth={2} aria-hidden />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
