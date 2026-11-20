/**
 * DeltaV (deltav.monad.xyz), Monad's founder hub: the startup profile and the weekly updates, through its API.
 * The key is read from .secrets/deltav.env (DELTAV_API_KEY) and never printed.
 *
 *   node apps/web/scripts/ops/deltav.mjs upload <file.png>            prints the stored file's key
 *   node apps/web/scripts/ops/deltav.mjs profile <profile.json>       PATCHes the profile; prints what the API returns
 *   node apps/web/scripts/ops/deltav.mjs update <update.txt> [xLink]  posts one weekly update (only after the founder's OK)
 *
 * Run from the repository root. A request that fails prints the status and the API's own message, and exits non-zero:
 * a failed call is never reported as done.
 */
import { readFileSync } from "node:fs";

const BASE = "https://deltav.monad.xyz/api/v1";
const env = Object.fromEntries(
  readFileSync(new URL("../../../../.secrets/deltav.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const key = env.DELTAV_API_KEY;
if (!key) throw new Error("DELTAV_API_KEY is not set in .secrets/deltav.env");

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // the API's message, with the key never in it
    console.error(`${method} ${path}: ${res.status} ${res.statusText}\n${text.slice(0, 2000)}`);
    process.exit(1);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "upload") {
  if (!a) throw new Error("usage: upload <file.png>");
  const data = readFileSync(a).toString("base64");
  const out = await call("POST", "/uploads", { contentType: a.endsWith(".jpg") || a.endsWith(".jpeg") ? "image/jpeg" : "image/png", data });
  console.log(JSON.stringify(out));
} else if (cmd === "profile") {
  if (!a) throw new Error("usage: profile <profile.json>");
  const out = await call("PATCH", "/startups", JSON.parse(readFileSync(a, "utf8")));
  console.log(JSON.stringify(out, null, 2));
} else if (cmd === "show") {
  // read the profile back, if the API offers it (the key's scopes are for writing)
  console.log(JSON.stringify(await call("GET", "/startups"), null, 2));
} else if (cmd === "update") {
  if (!a) throw new Error("usage: update <update.txt> [xLink]");
  const content = readFileSync(a, "utf8").trim();
  const out = await call("POST", "/weekly-updates", b ? { content, xLink: b } : { content });
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log("usage: upload <file.png> | profile <profile.json> | update <update.txt> [xLink]");
}
