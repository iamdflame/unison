import type { MetadataRoute } from "next";
import { site } from "@/lib/content/site";
import { THEME_COLOR } from "@/lib/theme/theme";

/** Installable: opens straight into the terminal, in Nocturne, with the dial icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Unison",
    short_name: "Unison",
    description: site.description,
    id: "/",
    start_url: "/trade/aNVDA",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME_COLOR.night,
    theme_color: THEME_COLOR.night,
    categories: ["finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Markets", url: "/markets" },
      { name: "Portfolio", url: "/portfolio" },
    ],
  };
}
