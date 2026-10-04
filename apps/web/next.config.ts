import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./lib/security/csp.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "../..");

/** Security headers shared by every route. The CSP is assembled in `lib/security/csp.ts`. */
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy(process.env, process.env.NODE_ENV !== "production") },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), " +
      "publickey-credentials-create=(self), publickey-credentials-get=(self)",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // the dev server's route badge is not part of the product, and it covered the phone tab bar in review captures
  devIndicators: false,
  // `SOURCE_MAPS=1 pnpm build` lets `scripts/weigh.mjs` attribute every first-load byte to its source.
  productionBrowserSourceMaps: process.env.SOURCE_MAPS === "1",
  // Workspace packages ship TypeScript sources (the `development` export condition); compile them in place.
  transpilePackages: ["@unison/sdk", "@unison/engine"],
  outputFileTracingRoot: root,
  turbopack: {
    root,
    resolveAlias: {
      "@unison/sdk": "./../../packages/sdk/src/index.ts",
      // light entry points, so pages that only need the market calendar don't pull viem in through the barrel
      "@unison/sdk/calendar": "./../../packages/sdk/src/calendar.ts",
      "@unison/sdk/types": "./../../packages/sdk/src/types.ts",
      "@unison/sdk/tape": "./../../packages/sdk/src/tape.ts",
      "@unison/sdk/relayer": "./../../packages/sdk/src/relayer.ts",
      "@unison/sdk/light": "./../../packages/sdk/src/light.ts",
      "@unison/sdk/errors": "./../../packages/sdk/src/errors.ts",
      "@unison/engine": "./../../packages/engine/src/index.ts",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
