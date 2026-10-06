/**
 * Copies the built plugin, and only what it ships, to a directory outside this repository. `mm plugins install file:`
 * with npm's install_links (copy, don't link) then loads it exactly as an npm install would. Node resolves the plugin's
 * `@metamask/agent-wallet/plugin` import from where the plugin really lives: installed in place it would find this
 * package's own dev copy, a second CLI bundle the host warns breaks plugins; linked, it would find no host at all.
 * Copied into mm's plugin directory, it finds the running CLI, which mm links in beside its plugins.
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
const path = out.replace(/\\/g, "/");
console.log(`staged ${pkg.name}@${pkg.version} at ${out}

  mm config set experimentalPlugins true
  mm config set experimentalAllowUnverifiedInstalls true

  bash:        npm_config_install_links=true mm plugins install "file:${path}" --accept-permissions
  PowerShell:  $env:npm_config_install_links="true"; mm plugins install "file:${path}" --accept-permissions`);
