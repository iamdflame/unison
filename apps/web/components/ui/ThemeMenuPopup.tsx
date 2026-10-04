"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, Clock, Moon, Monitor, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme/ThemeProvider";
import type { Palette, ThemeMode } from "@/lib/theme/theme";
import { THEME_TRIGGER, ThemeGlyph, themeHandoff } from "./ThemeMenu";

const MODES: { mode: ThemeMode; label: string; hint: string; Icon: typeof Sun }[] = [
  { mode: "market", label: "Market hours", hint: "Day while Wall Street trades, night while it's closed", Icon: Clock },
  { mode: "light", label: "Day", hint: "Porcelain", Icon: Sun },
  { mode: "dark", label: "Night", hint: "Nocturne", Icon: Moon },
  { mode: "system", label: "System", hint: "Follow this device", Icon: Monitor },
];

/** Buy and sell colors; each option shows its own pair, read from the palette tokens of the current light. */
const PALETTES: { palette: Palette; label: string; hint: string; buy: string; sell: string }[] = [
  { palette: "standard", label: "Verdigris and garnet", hint: "The house colors", buy: "var(--buy-std)", sell: "var(--sell-std)" },
  { palette: "cvd", label: "Steel and amber", hint: "Clearer apart with color blindness", buy: "var(--buy-cvd)", sell: "var(--sell-cvd)" },
];

const ITEM = "flex cursor-default items-start gap-3 rounded-2xl px-3 py-2.5 outline-none select-none data-[highlighted]:bg-ink/[0.06]";
const GROUP_LABEL = "px-3 pt-2 pb-1 text-xs font-medium text-ink-3";

/** The switch with its menu (Base UI): the light, and the colors buy and sell are drawn in. */
export function ThemeMenuPopup() {
  const { mode, setMode, palette, setPalette } = useTheme();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(() => themeHandoff.open);
  useEffect(() => {
    if (themeHandoff.focused) trigger.current?.focus();
    themeHandoff.focused = false;
    themeHandoff.open = false;
  }, []);
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger ref={trigger} aria-label="Appearance" className={THEME_TRIGGER}>
        <ThemeGlyph />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={10} align="end" className="z-[60] outline-none">
          <Menu.Popup className="glass w-72 origin-[var(--transform-origin)] rounded-[22px] p-1.5 shadow-lg outline-none transition-[scale,opacity] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:duration-[140ms] data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <Menu.Group>
              <Menu.GroupLabel className={GROUP_LABEL}>Light</Menu.GroupLabel>
              <Menu.RadioGroup value={mode} onValueChange={(v) => setMode(v as ThemeMode)}>
                {MODES.map(({ mode: m, label, hint, Icon }) => (
                  <Menu.RadioItem key={m} value={m} className={ITEM}>
                    <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-2" aria-hidden />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-ink">{label}</span>
                      <span className="block text-xs leading-snug text-ink-3">{hint}</span>
                    </span>
                    <Menu.RadioItemIndicator className="mt-0.5 text-accent">
                      <Check size={15} strokeWidth={2} aria-hidden />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <Menu.Separator className="mx-3 my-1.5 h-px bg-line" />
            <Menu.Group>
              <Menu.GroupLabel className={GROUP_LABEL}>Buy and sell</Menu.GroupLabel>
              <Menu.RadioGroup value={palette} onValueChange={(v) => setPalette(v as Palette)}>
                {PALETTES.map((p) => (
                  <Menu.RadioItem key={p.palette} value={p.palette} className={ITEM}>
                    <span className="mt-1 flex shrink-0 gap-1" aria-hidden>
                      <span className="size-2.5 rounded-full" style={{ background: p.buy }} />
                      <span className="size-2.5 rounded-full" style={{ background: p.sell }} />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-ink">{p.label}</span>
                      <span className="block text-xs leading-snug text-ink-3">{p.hint}</span>
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
