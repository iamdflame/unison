import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next registers the jsx-a11y plugin; we turn on its full recommended rule set on top.
  { rules: { ...jsxA11y.flatConfigs.recommended.rules } },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts", "public/**", "playwright-report/**", "test-results/**"]),
]);
