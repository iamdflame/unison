import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sdk = fileURLToPath(new URL("../../packages/sdk/src", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@unison/sdk": sdk }, conditions: ["development"] },
  test: { include: ["test/**/*.test.ts"], testTimeout: 120_000 },
});
