"use client";

import { Clock, Moon, Sun } from "lucide-react";
import dynamic from "next/dynamic";
import { useTheme } from "@/lib/theme/ThemeProvider";

export const THEME_TRIGGER =
  "press tap grid size-9 place-items-center rounded-full text-ink-2 outline-none hover-fine:bg-ink/[0.06] hover-fine:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-[popup-open]:bg-ink/[0.06]";

/** The switch's face: a clock while the light follows the market, otherwise the sun or the moon. */
export function ThemeGlyph() {
  const { mode, theme } = useTheme();
  const Current = mode === "market" ? Clock : theme === "night" ? Moon : Sun;
  return <Current size={17} strokeWidth={1.5} aria-hidden />;
}

/** A focus or press that reached the switch before its menu did, for the menu to pick up. */
export const themeHandoff = { focused: false, open: false };

function Standby() {
  return (
    <button
      type="button"
      aria-label="Appearance"
      aria-haspopup="menu"
      aria-expanded={false}
      className={THEME_TRIGGER}
      onFocus={() => (themeHandoff.focused = true)}
      onBlur={() => (themeHandoff.focused = false)}
      onClick={() => (themeHandoff.open = true)}
    >
      <ThemeGlyph />
    </button>
  );
}

/**
 * The light switch. "Market hours" (default) lets the page's light follow the US equity session. The menu behind
 * it arrives a moment after the page is interactive; until then the page shows (and the switch answers as) this
 * same button.
 */
export const ThemeMenu = dynamic(() => import("./ThemeMenuPopup").then((m) => m.ThemeMenuPopup), { ssr: false, loading: Standby });
