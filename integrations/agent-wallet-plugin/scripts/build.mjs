/**
 * Bundles each command into dist/commands (oclif loads every file there as a command), with the Unison SDK, viem and
 * the deployment record inside, so the installed plugin has no dependencies of its own. The host CLI stays external:
 * a plugin must import the running mm's own `@metamask/agent-wallet/plugin`, never a copy.
 *
 *   node scripts/build.mjs
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });

rmSync(join(root, "dist"), { recursive: true, force: true });
await build({
  absWorkingDir: root,
  entryPoints: walk(join(root, "src", "commands")),
  outdir: "dist",
  outbase: "src",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  conditions: ["development"],
  alias: { "@unison/sdk": join(root, "..", "..", "packages", "sdk", "src") },
  external: ["@metamask/agent-wallet", "@metamask/agent-wallet/*"],
  chunkNames: "chunks/[name]-[hash]",
  legalComments: "none",
  // readable on purpose: whoever consents to this plugin can read what it does
  minify: false,
  banner: { js: "// mm-plugin-unison · https://github.com/iamdflame/unison/tree/main/integrations/agent-wallet-plugin" },
  logLevel: "warning",
});
console.log(`built ${walk(join(root, "src", "commands")).length} commands into dist/`);
