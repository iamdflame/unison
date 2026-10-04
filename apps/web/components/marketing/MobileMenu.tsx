"use client";

import dynamic from "next/dynamic";

export const MENU_TRIGGER = "press tap grid size-9 place-items-center rounded-full text-ink-2 hover-fine:bg-ink/[0.06] md:hidden";

export function MenuGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden>
      <path d="M3 7h14M3 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** A focus or tap that reached the button before the sheet did, for the sheet to pick up. */
export const menuHandoff = { focused: false, open: false };

function Standby() {
  return (
    <button
      type="button"
      aria-label="Menu"
      aria-haspopup="dialog"
      className={MENU_TRIGGER}
      onFocus={() => (menuHandoff.focused = true)}
      onBlur={() => (menuHandoff.focused = false)}
      onClick={() => (menuHandoff.open = true)}
    >
      <MenuGlyph />
    </button>
  );
}

/** Phones: the site's contents. The sheet arrives just after the page is interactive; this button stands in. */
export const MobileMenu = dynamic(() => import("./MobileMenuSheet").then((m) => m.MobileMenuSheet), { ssr: false, loading: Standby });
