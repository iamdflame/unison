import type { MetadataRoute } from "next";
import { site } from "@/lib/content/site";

/** The public, indexable pages. The trading app and the lab are not indexed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number][] = [
    ["", 1],
    ["/fairness", 0.8],
    ["/developers", 0.8],
    ["/status", 0.5],
    ["/brand", 0.4],
    ["/legal/terms", 0.2],
    ["/legal/privacy", 0.2],
    ["/legal/risk", 0.3],
  ];
  return pages.map(([path, priority]) => ({ url: `${site.url}${path}`, changeFrequency: path === "" || path === "/fairness" ? "daily" : "monthly", priority }));
}
