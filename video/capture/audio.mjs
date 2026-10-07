/**
 * Copies your ElevenLabs files from video/audio/ (where SCRIPT.md says to save them) into public/audio/, where the
 * films read them. Remotion bundles public/ as files, so a link won't do. Lists what the films still lack.
 *
 *   node capture/audio.mjs             (from video/, before a render)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { processSfx } from "./sfx.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FROM = join(ROOT, "audio");
const TO = join(ROOT, "public", "audio");
mkdirSync(TO, { recursive: true });

const files = existsSync(FROM) ? readdirSync(FROM).filter((f) => /\.(mp3|wav|m4a)$/i.test(f)) : [];
/** The name a film reads a file by: "demo1.mp3" and "demo-01.mp3" are both demo-01, "picth1" is pitch-01, "add" the ad. */
const canonical = (f) => {
  const m = f.toLowerCase().match(/^(demo|pitch|picth|ptich|mm|cre|envio)[-_ ]?0*(\d+)\.(mp3|wav|m4a)$/);
  if (m) return `${m[1].startsWith("p") ? "pitch" : m[1]}-${m[2].padStart(2, "0")}.${m[3]}`;
  if (/^(ad|add)(-?0*1)?\.(mp3|wav|m4a)$/i.test(f)) return `ad-01.${f.split(".").pop().toLowerCase()}`;
  return f;
};
// two takes of one file ("demo5.mp3", then "demo-5.mp3"): the newest is the take
const newest = new Map();
for (const f of files) {
  const to = canonical(f);
  const prev = newest.get(to);
  if (!prev || statSync(join(FROM, f)).mtimeMs > statSync(join(FROM, prev)).mtimeMs) newest.set(to, f);
}
for (const [to, f] of newest) {
  const older = files.filter((x) => x !== f && canonical(x) === to);
  if (older.length) console.log(`${to}: using ${f}, the newest (not ${older.join(", ")})`);
}
// effects are trimmed to their hit and levelled (capture/sfx.mjs); which source each was made from is kept here
const MADE = join(TO, ".sfx.json");
const made = existsSync(MADE) ? JSON.parse(readFileSync(MADE, "utf8")) : {};
let copied = 0;
for (const f of newest.values()) {
  const to = canonical(f);
  const a = statSync(join(FROM, f));
  if (/^sfx-/.test(to)) {
    if (made[to]?.size === a.size && made[to]?.mtimeMs === a.mtimeMs && existsSync(join(TO, to))) continue;
    const r = processSfx(join(FROM, f), join(TO, to));
    made[to] = { size: a.size, mtimeMs: a.mtimeMs, trimmed: r.trimmed, gain: r.gain };
    console.log(`${to}: trimmed ${(r.trimmed * 1000).toFixed(0)} ms before its hit, gain ×${r.gain.toFixed(1)}`);
    copied++;
    continue;
  }
  const b = existsSync(join(TO, to)) ? statSync(join(TO, to)) : null;
  if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
  copyFileSync(join(FROM, f), join(TO, to));
  if (to !== f) console.log(`${f} → ${to}`);
  copied++;
}
writeFileSync(MADE, `${JSON.stringify(made, null, 2)}
`);
const want = [
  ...Array.from({ length: 12 }, (_, i) => `demo-${String(i + 1).padStart(2, "0")}.mp3`),
  ...Array.from({ length: 6 }, (_, i) => `pitch-0${i + 1}.mp3`),
  "ad-01.mp3",
  ...Array.from({ length: 6 }, (_, i) => `mm-0${i + 1}.mp3`),
  ...Array.from({ length: 5 }, (_, i) => `cre-0${i + 1}.mp3`),
  ...Array.from({ length: 4 }, (_, i) => `envio-0${i + 1}.mp3`),
  "music-demo.mp3",
  "music-pitch.mp3",
  ...["tick", "seal", "chime", "pass", "whoosh", "shutter"].map((x) => `sfx-${x}.mp3`),
];
const missing = want.filter((f) => !existsSync(join(TO, f)));
console.log(`${copied} copied, ${files.length} in video/audio; ${want.length - missing.length} of ${want.length} the films use are in place`);
if (missing.length) console.log(`still to come: ${missing.join(", ")}`);
