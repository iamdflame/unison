/**
 * Reads SCRIPT.md, the voiceover you generate in ElevenLabs (Eleven v4), into src/data/script.json: for each file
 * (demo-01, …, envio-04), its lines in order. Each line of a block is one line of the film: the captions show it,
 * without its [bracketed directions], and a scene can land a moment on it (useLine). The pause after a line is a
 * first guess from how it ends, until the real audio is aligned (capture/align.mjs).
 *
 *   node capture/script.mjs            (from video/, whenever SCRIPT.md changes)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const md = readFileSync(join(ROOT, "SCRIPT.md"), "utf8").replace(/\r\n/g, "\n");
const out = {};
// v4 reads a held beat after "…", a quick break after "—", and a breath at every new line
const pauseAfter = (line) => (/…$/.test(line) ? 0.55 : /—$/.test(line) ? 0.3 : /[:,]$/.test(line) ? 0.3 : 0.45);
for (const m of md.matchAll(/^### ([a-z]+-\d+)\.mp3[^\n]*\n(?:(?!^### )[\s\S])*?```\n([\s\S]*?)\n```/gm)) {
  const [, id, body] = m;
  const lines = body
    .split("\n")
    .map((l) => l.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  out[id] = lines.map((text, i) => ({ text, pause: i === lines.length - 1 ? 0 : pauseAfter(text) }));
}
const ids = Object.keys(out);
if (!ids.includes("demo-01") || !ids.includes("pitch-01") || !ids.includes("envio-04")) throw new Error(`SCRIPT.md parsed to ${ids.join(", ")}`);
writeFileSync(join(ROOT, "src", "data", "script.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${ids.length} voice files: ${ids.map((id) => `${id} (${out[id].length})`).join(", ")}`);
