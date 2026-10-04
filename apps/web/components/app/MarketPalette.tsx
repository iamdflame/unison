"use client";

import { Command } from "cmdk";
import { Search } from "lucide-react";
import { MARKETS } from "@/lib/content/markets";

/** The ⌘K palette itself: any market, or anywhere in the app. Fetched on demand by MarketSwitcher. */
export function MarketPalette({ open, onOpenChange, go }: { open: boolean; onOpenChange: (o: boolean) => void; go: (href: string) => void }) {
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Go to"
      overlayClassName="fixed inset-0 z-[70] bg-scrim backdrop-blur-[2px] data-[state=open]:animate-[fade-in_160ms_ease-out]"
      contentClassName="fixed top-[14vh] left-1/2 z-[71] w-[min(92vw,560px)] -translate-x-1/2 overflow-hidden rounded-[var(--radius-xl)] bg-raised shadow-lg hairline"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={16} strokeWidth={1.5} className="text-ink-3" aria-hidden />
        <Command.Input placeholder="Search markets, pages…" className="h-13 w-full bg-transparent py-4 text-[15px] text-ink outline-none placeholder:text-ink-3" />
      </div>
      <Command.List className="max-h-[50vh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-ink-3">Nothing matches.</Command.Empty>
        <Command.Group heading="Markets" className="px-1 text-xs text-ink-3 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2">
          {MARKETS.map((m) => (
            <Command.Item
              key={m.ticker}
              value={`${m.ticker} ${m.name} ${m.underlying}`}
              onSelect={() => go(`/trade/${m.ticker}`)}
              className="flex cursor-default items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink data-[selected=true]:bg-ink/[0.06]"
            >
              <span className="w-16 font-semibold">{m.ticker}</span>
              <span className="text-ink-2">{m.name}</span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Go to" className="px-1 text-xs text-ink-3 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2">
          {[
            ["Portfolio", "/portfolio"],
            ["Vaults", "/vaults"],
            ["Session keys", "/keys"],
            ["Fairness monitor", "/fairness"],
            ["Home", "/"],
          ].map(([label, href]) => (
            <Command.Item key={href} value={label} onSelect={() => go(href!)} className="flex cursor-default items-center rounded-xl px-3 py-2.5 text-sm text-ink data-[selected=true]:bg-ink/[0.06]">
              {label}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
