"use client";

import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/lib/theme/ThemeProvider";

/** Sonner, dressed in the system: one glass layer, concentric radius, quiet type. */
export function Toaster() {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme === "night" ? "dark" : "light"}
      position="top-center"
      offset={68}
      gap={10}
      toastOptions={{
        classNames: {
          toast: "!glass !rounded-[22px] !border-0 !shadow-lg !px-4 !py-3.5 !font-sans !text-ink",
          title: "!text-[14px] !font-semibold",
          description: "!text-[13px] !text-ink-2",
        },
      }}
    />
  );
}
