import { defineConfig } from "vitest/config";

// As Envio's own scenarios run it: one forked worker, and every non-test file loaded by Node itself, so the envio
// package finds its native addon from import.meta.url and the handlers it loads share one registry with the tests.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    pool: "forks",
    maxWorkers: 1,
    testTimeout: 120_000,
    server: { deps: { external: [/^(?!.*\.(test|spec)\.)(?!.*_test\.)(?!.*\/test\/).*$/i] } },
  },
});
