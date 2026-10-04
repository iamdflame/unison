"use client";

import { useSyncExternalStore } from "react";
import {
  isThemeMode,
  msUntilSessionChange,
  PALETTE_KEY,
  resolveTheme,
  THEME_COLOR,
  THEME_KEY,
  type Palette,
  type Theme,
  type ThemeMode,
} from "./theme.ts";

/**
 * The page's light as an external store: the boot script owns first paint, this store keeps it honest while the
 * page stays open (market sessions open and close, the OS flips dark mode) and lets settings change it.
 */
interface Snapshot {
  mode: ThemeMode;
  theme: Theme;
  palette: Palette;
}

const SERVER: Snapshot = { mode: "market", theme: "day", palette: "standard" };
let snapshot: Snapshot = SERVER;
let started = false;
let stopWatching: (() => void) | null = null;
const listeners = new Set<() => void>();

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
};
const prefersDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

/** Applies a theme with transitions suspended for one frame, so nothing smears mid-flip. */
function paint(theme: Theme, mode: ThemeMode, animate: boolean) {
  const root = document.documentElement;
  if (root.dataset.theme === theme && root.dataset.themeMode === mode) return;
  const flip = () => {
    root.setAttribute("data-theme-switching", "");
    root.dataset.theme = theme;
    root.dataset.themeMode = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
    void root.offsetHeight;
    requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
  };
  const vt = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
  if (animate && vt && !reducedMotion()) vt.call(document, flip);
  else flip();
}

function sync(animate: boolean) {
  const theme = resolveTheme(snapshot.mode, new Date(), prefersDark());
  paint(theme, snapshot.mode, animate);
  if (theme !== snapshot.theme) publish({ ...snapshot, theme });
}

/** Follows the market's session (or the OS) for as long as the current mode needs it. */
function watch() {
  stopWatching?.();
  stopWatching = null;
  if (snapshot.mode === "system") {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => sync(false);
    mq.addEventListener("change", on);
    stopWatching = () => mq.removeEventListener("change", on);
  } else if (snapshot.mode === "market") {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Capped so sleep/wake and clock changes can't strand the page in the wrong light.
      timer = setTimeout(() => {
        sync(true);
        schedule();
      }, Math.min(msUntilSessionChange(new Date()) + 500, 30 * 60_000));
    };
    schedule();
    const onVisible = () => document.visibilityState === "visible" && sync(false);
    document.addEventListener("visibilitychange", onVisible);
    stopWatching = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }
}

function start() {
  if (started) return;
  started = true;
  const stored = read(THEME_KEY);
  const mode = isThemeMode(stored) ? stored : "market";
  const painted = document.documentElement.dataset.theme;
  snapshot = {
    mode,
    theme: painted === "night" || painted === "day" ? painted : resolveTheme(mode, new Date(), prefersDark()),
    palette: read(PALETTE_KEY) === "cvd" ? "cvd" : "standard",
  };
  watch();
}

export const themeStore = {
  subscribe(listener: () => void) {
    start();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => snapshot,
  getServerSnapshot: () => SERVER,
  setMode(mode: ThemeMode) {
    write(THEME_KEY, mode);
    const theme = resolveTheme(mode, new Date(), prefersDark());
    paint(theme, mode, false);
    publish({ ...snapshot, mode, theme });
    watch();
  },
  setPalette(palette: Palette) {
    write(PALETTE_KEY, palette);
    if (palette === "cvd") document.documentElement.dataset.palette = "cvd";
    else delete document.documentElement.dataset.palette;
    publish({ ...snapshot, palette });
  },
};

export function useTheme() {
  const s = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getServerSnapshot);
  return { ...s, setMode: themeStore.setMode, setPalette: themeStore.setPalette };
}
