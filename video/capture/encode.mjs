/**
 * Turns each captured segment (footage/live/<name>/: JPEG frames named by the time Chrome painted them) into a
 * constant 60 fps MP4 in public/footage/, each frame held until the next was painted, as a screen recording would.
 * Writes each segment's length, capture time and clicks (in seconds from its first frame) to src/data/footage.json,
 * for the film's cuts and its cursor.
 *
 *   node capture/encode.mjs [take…]    (from video/, after capture/live.mjs; given takes, only those are redone)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IN = join(ROOT, "footage", "live");
const OUT = join(ROOT, "public", "footage");
const FFMPEG = join(ROOT, "node_modules", "@remotion", `compositor-${process.platform === "win32" ? "win32-x64-msvc" : `${process.platform}-${process.arch}`}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
// a segment ends on a still: its last frame stays this long
const HOLD = 0.5;

mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const FOOTAGE = join(ROOT, "src", "data", "footage.json");
// redoing some takes keeps the others as they were encoded
const meta = only.length && existsSync(FOOTAGE) ? JSON.parse(readFileSync(FOOTAGE, "utf8")) : {};
for (const name of readdirSync(IN).sort()) {
  if (only.length && !only.includes(name)) continue;
  const dir = join(IN, name);
  const frames = readdirSync(dir)
    .filter((f) => f.endsWith(".jpg"))
    .sort((a, b) => parseFloat(a) - parseFloat(b));
  if (frames.length < 2) continue;
  const ts = frames.map((f) => parseFloat(f));
  const start = ts[0];
  // the concat demuxer's durations make the variable frame rate explicit; a constant 60 fps output then samples it evenly
  const list = ["ffconcat version 1.0"];
  frames.forEach((f, i) => list.push(`file '${f}'`, `duration ${((ts[i + 1] ?? ts[i] + HOLD) - ts[i]).toFixed(4)}`));
  list.push(`file '${frames.at(-1)}'`);
  writeFileSync(join(dir, "frames.ffconcat"), `${list.join("\n")}\n`);
  // a take captured at twice the density stays 4K, a little more compressed
  const shot = existsSync(join(dir, "meta.json")) ? JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) : { viewport: { width: 1920, height: 1080 }, dsf: 1 };
  execFileSync(
    FFMPEG,
    ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "frames.ffconcat"), "-fps_mode", "cfr", "-r", "60", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", shot.dsf > 1 ? "16" : "12", "-movflags", "+faststart", join(OUT, `${name}.mp4`)],
    { stdio: "inherit" },
  );
  const events = existsSync(join(dir, "events.json")) ? JSON.parse(readFileSync(join(dir, "events.json"), "utf8")) : [];
  meta[name] = {
    file: `footage/${name}.mp4`,
    seconds: Number((ts.at(-1) + HOLD - start).toFixed(3)),
    capturedAt: new Date(start * 1000).toISOString(),
    viewport: shot.viewport,
    dsf: shot.dsf,
    clicks: events.map((e) => ({ at: Number((e.t - start).toFixed(3)), x: Math.round(e.x), y: Math.round(e.y), label: e.label })),
  };
  console.log(`${name}: ${frames.length} frames, ${meta[name].seconds} s`);
}
writeFileSync(FOOTAGE, `${JSON.stringify(meta, null, 2)}\n`);
