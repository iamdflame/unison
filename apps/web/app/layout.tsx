import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Fragment_Mono, Mona_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { ThemeWatcher } from "@/lib/theme/ThemeWatcher";
import { themeBootScript } from "@/lib/theme/script";
import { THEME_COLOR } from "@/lib/theme/theme";
import { site } from "@/lib/content/site";
import "./globals.css";

const display = Bodoni_Moda({
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  variable: "--font-bodoni",
  display: "swap",
});
const sans = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-mona", display: "swap" });
const mono = Fragment_Mono({ subsets: ["latin"], weight: "400", variable: "--font-fragment", display: "swap", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name}: ${site.tagline}`, template: `%s · ${site.name}` },
  description: site.description,
  applicationName: site.name,
  openGraph: { type: "website", siteName: site.name, title: `${site.name}: ${site.tagline}`, description: site.description },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false, address: false, email: false },
  appleWebApp: { capable: true, title: site.name, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="day"
      data-theme-mode="market"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content={THEME_COLOR.day} />
        {/* Sets the light before first paint: day while Wall Street trades, night while it's closed. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-full focus:bg-raised focus:px-4 focus:py-2 focus:shadow-md"
        >
          Skip to content
        </a>
        {children}
        <ThemeWatcher />
      </body>
    </html>
  );
}
