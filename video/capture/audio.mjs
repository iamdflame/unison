/**
 * Copies your ElevenLabs files from video/audio/ (where SCRIPT.md says to save them) into public/audio/, where the
 * films read them. Remotion bundles public/ as files, so a link won't do. Lists what the films still lack.
 *
 *   node capture/audio.mjs             (from video/, before a render)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FROM = join(ROOT, "audio");
const TO = join(ROOT, "public", "audio");
mkdirSync(TO, { recursive: true });

const files = existsSync(FROM) ? readdirSync(FROM).filter((f) => /\.(mp3|wav|m4a)$/i.test(f)) : [];
let copied = 0;
for (const f of files) {
  const a = statSync(join(FROM, f));
  const b = existsSync(join(TO, f)) ? statSync(join(TO, f)) : null;
  if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
  copyFileSync(join(FROM, f), join(TO, f));
  copied++;
}
const want = [
  ...Array.from({ length: 11 }, (_, i) => `demo-${String(i + 1).padStart(2, "0")}.mp3`),
  ...Array.from({ length: 6 }, (_, i) => `pitch-0${i + 1}.mp3`),
  "ad-01.mp3",
  "music-demo.mp3",
  "music-pitch.mp3",
  ...["tick", "seal", "chime", "pass", "whoosh", "shutter"].map((x) => `sfx-${x}.mp3`),
];
const missing = want.filter((f) => !existsSync(join(TO, f)));
console.log(`${copied} copied, ${files.length} in video/audio; ${want.length - missing.length} of ${want.length} the films use are in place`);
if (missing.length) console.log(`still to come: ${missing.join(", ")}`);
