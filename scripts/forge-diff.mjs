// Cross-platform launcher: runs the Solidity/TypeScript differential suite (Foundry profile "diff", FFI on).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const r = spawnSync("forge", ["test", ...process.argv.slice(2)], {
  cwd: join(root, "contracts"),
  env: { ...process.env, FOUNDRY_PROFILE: "diff" },
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
