"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, Clock, Moon, Monitor, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme/ThemeProvider";
import type { ThemeMode } from "@/lib/theme/theme";
import { THEME_TRIGGER, ThemeGlyph, themeHandoff } from "./ThemeMenu";

const MODES: { mode: ThemeMode; label: string; hint: string; Icon: typeof Sun }[] = [
  { mode: "market", label: "Market hours", hint: "Day while Wall Street trades, night while it's closed", Icon: Clock },
  { mode: "light", label: "Day", hint: "Porcelain", Icon: Sun },
  { mode: "dark", label: "Night", hint: "Nocturne", Icon: Moon },
  { mode: "system", label: "System", hint: "Follow this device", Icon: Monitor },
];

/** The switch with its menu (Base UI): four lights, the current one checked. */
export function ThemeMenuPopup() {
  const { mode, setMode } = useTheme();
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
            <Menu.RadioGroup value={mode} onValueChange={(v) => setMode(v as ThemeMode)}>
              {MODES.map(({ mode: m, label, hint, Icon }) => (
                <Menu.RadioItem
                  key={m}
                  value={m}
                  className="flex cursor-default items-start gap-3 rounded-2xl px-3 py-2.5 outline-none select-none data-[highlighted]:bg-ink/[0.06]"
                >
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
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
