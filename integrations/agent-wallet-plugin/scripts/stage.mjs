/**
 * Copies the built plugin, and only what it ships, to a directory outside this repository, so `mm plugins install
 * file:` loads it exactly as an npm install would. Installed in place, Node would resolve the plugin's host import from
 * this package's own node_modules (its dev copy of @metamask/agent-wallet), a second CLI bundle that the host warns
 * breaks plugins.
 *
 *   node scripts/stage.mjs [dir]      (default: <tmp>/mm-plugin-unison)
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), "mm-plugin-unison");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
rmSync(out, { recursive: true, force: true });
for (const f of pkg.files) cpSync(join(root, f), join(out, f), { recursive: true });
// what an npm install would see: no dev dependencies or scripts, only the plugin and its peer
const { devDependencies: _d, scripts: _s, ...shipped } = pkg;
writeFileSync(join(out, "package.json"), `${JSON.stringify(shipped, null, 2)}\n`);
console.log(`staged ${pkg.name}@${pkg.version} at ${out}

  mm config set experimentalPlugins true
  mm config set experimentalAllowUnverifiedInstalls true
  mm plugins install "file:${out.replace(/\\/g, "/")}" --accept-permissions`);
