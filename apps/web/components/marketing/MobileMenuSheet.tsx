"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MENU_TRIGGER, MenuGlyph, menuHandoff } from "./MobileMenu";

const LINKS = [
  ["/markets", "Markets"],
  ["/fairness", "Fairness"],
  ["/developers", "Developers"],
  ["/status", "Status"],
  ["/brand", "Brand"],
] as const;

/** Phones: the site's sections as a contents page, set large, one tap from anywhere. */
export function MobileMenuSheet() {
  const [open, setOpen] = useState(() => menuHandoff.open);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (menuHandoff.focused) trigger.current?.focus();
    menuHandoff.focused = false;
    menuHandoff.open = false;
  }, []);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger ref={trigger} className={MENU_TRIGGER} aria-label="Menu">
        <MenuGlyph />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Popup className="fixed inset-0 z-[90] flex flex-col bg-bg px-6 pt-[max(20px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] outline-none transition-[opacity,transform] duration-[260ms] ease-[cubic-bezier(0.23,1,0.32,1)] data-[ending-style]:-translate-y-2 data-[ending-style]:opacity-0 data-[starting-style]:-translate-y-2 data-[starting-style]:opacity-0">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm text-ink-3">Unison</Dialog.Title>
            <Dialog.Close className="press tap grid size-10 place-items-center rounded-full text-ink-2 hover-fine:bg-ink/[0.06]" aria-label="Close">
              <X size={18} strokeWidth={1.75} aria-hidden />
            </Dialog.Close>
          </div>
          <nav aria-label="Sections" className="mt-10">
            <ul className="divide-y divide-line border-y border-line">
              {LINKS.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} onClick={() => setOpen(false)} className="text-display-m block py-4 text-ink">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Link href="/trade/aNVDA" onClick={() => setOpen(false)} className="press mt-auto rounded-full bg-ink py-4 text-center text-[16px] font-semibold text-bg shadow-md">
            Start trading
          </Link>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
