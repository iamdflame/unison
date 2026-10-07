/**
 * Reads SCRIPT.md, the voiceover you generate in ElevenLabs, into src/data/script.json: for each file (demo-01, …,
 * pitch-06, ad-01), its lines split at the <break> tags, each with the pause that follows it. The film burns these
 * in as captions, timed across the real audio once it exists, so a caption never says what the voice doesn't.
 *
 *   node capture/script.mjs            (from video/, whenever SCRIPT.md changes)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const md = readFileSync(join(ROOT, "SCRIPT.md"), "utf8").replace(/\r\n/g, "\n");
const out = {};
for (const m of md.matchAll(/^### ([a-z]+-\d+)\.mp3[^\n]*\n(?:(?!^### )[\s\S])*?```\n([\s\S]*?)\n```/gm)) {
  const [, id, body] = m;
  const segments = [];
  // a <break time="0.4s" /> ends a segment and is the pause after it
  const parts = body.trim().split(/<break time="([\d.]+)s"\s*\/>/);
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i].replace(/\s+/g, " ").trim();
    const pause = parts[i + 1] ? Number(parts[i + 1]) : 0;
    if (text) segments.push({ text, pause });
    else if (segments.length) segments.at(-1).pause += pause;
  }
  out[id] = segments;
}
const ids = Object.keys(out);
if (!ids.includes("demo-01") || !ids.includes("pitch-01")) throw new Error(`SCRIPT.md parsed to ${ids.join(", ")}`);
writeFileSync(join(ROOT, "src", "data", "script.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${ids.length} voice files: ${ids.join(", ")}`);
