/**
 * ElevenLabs, from this machine. The API key is read from the repo root's .env.local by its name alone
 * (ELEVENLABS_API_KEY): no other line of that file is used, and the key is never printed or written anywhere.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let cached;
export function apiKey() {
  if (cached) return cached;
  const env = readFileSync(fileURLToPath(new URL("../../.env.local", import.meta.url)), "utf8");
  const m = env.match(/^[ \t]*(?:export[ \t]+)?ELEVENLABS_API_KEY[ \t]*=[ \t]*["']?([^"'\r\n#]+?)["']?[ \t]*(?:#.*)?$/m);
  if (!m) throw new Error("ELEVENLABS_API_KEY is not set in .env.local");
  cached = m[1].trim();
  return cached;
}

/** A call to the API: JSON in, JSON or bytes out. Errors carry the status and the API's message, never the key. */
export async function eleven(path, { method = "GET", body, raw = false } = {}) {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method,
    headers: { "xi-api-key": apiKey(), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs ${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}
