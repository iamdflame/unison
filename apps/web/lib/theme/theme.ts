import { usEquitySession } from "@unison/sdk/calendar";
import { Status, type StatusCode } from "@unison/sdk/types";
import { marketMoment } from "../time/market.ts";

/** What the visitor chose. "market" (default) lets the light follow the US equity session. */
export type ThemeMode = "market" | "light" | "dark" | "system";
/** What the page shows. */
export type Theme = "day" | "night";
export type Palette = "standard" | "cvd";

export const THEME_KEY = "unison.theme";
export const PALETTE_KEY = "unison.palette";
export const THEME_MODES: readonly ThemeMode[] = ["market", "light", "dark", "system"];

/** Browser chrome colors (hex mirrors of --bg). */
export const THEME_COLOR: Record<Theme, string> = { day: "#f9fafc", night: "#0b0c10" };

/** Day while Wall Street trades (regular or extended hours), night while it is closed. */
export const themeForSession = (status: StatusCode): Theme => (status === Status.CLOSED ? "night" : "day");

export function resolveTheme(mode: ThemeMode, now: Date, prefersDark: boolean): Theme {
  switch (mode) {
    case "light":
      return "day";
    case "dark":
      return "night";
    case "system":
      return prefersDark ? "night" : "day";
    default:
      return themeForSession(usEquitySession(now));
  }
}

/** Milliseconds until the market-driven theme can next change. */
export function msUntilSessionChange(now: Date): number {
  return Math.max(1_000, marketMoment(now).nextChange.getTime() - now.getTime());
}

export const isThemeMode = (v: unknown): v is ThemeMode => typeof v === "string" && (THEME_MODES as readonly string[]).includes(v);
