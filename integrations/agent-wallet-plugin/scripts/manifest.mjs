/**
 * Writes oclif.manifest.json the way `oclif manifest` does: loads the plugin from its built commands and records each
 * one's id, description, flags and args, so the host lists and helps without loading code.
 *
 *   node scripts/manifest.mjs
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Plugin } from "@oclif/core";

const root = fileURLToPath(new URL("..", import.meta.url));
const plugin = new Plugin({ root, type: "core", isRoot: true, ignoreManifest: true, errorOnManifestCreate: true, respectNoCacheDefault: true });
await plugin.load();
const ids = Object.keys(plugin.manifest.commands);
const declared = JSON.parse((await import("node:fs")).readFileSync(join(root, "package.json"), "utf8")).mm.commands.map((c) => c.id);
const missing = declared.filter((id) => !ids.includes(id));
const extra = ids.filter((id) => !declared.includes(id));
if (missing.length || extra.length) throw new Error(`package.json#mm and the built commands disagree: missing ${missing.join(", ") || "none"}; undeclared ${extra.join(", ") || "none"}`);
writeFileSync(join(root, "oclif.manifest.json"), `${JSON.stringify(plugin.manifest, null, 2)}\n`);
console.log(`oclif.manifest.json: ${ids.length} commands, matching package.json#mm`);
