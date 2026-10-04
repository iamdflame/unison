"use client";

import { useTheme } from "./ThemeProvider.tsx";

/** Mounted once in the root layout: keeps the light following the market (or the OS) while the page is open. */
export function ThemeWatcher() {
  useTheme();
  return null;
}
