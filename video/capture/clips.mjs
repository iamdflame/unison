/**
 * Clips of the demo for X, which plays a free account's video up to 2:20 (the demo runs 2:32): each clip is whole
 * beats of the film, cut on the film's own cuts, re-encoded at 30 fps, its sound eased in over 0.25 s and out over
 * 0.5 s so the music never starts or stops on a click. Beat starts are the film's own (capture/timeline.mjs Demo).
 *
 *   node capture/clips.mjs            (from video/, after node capture/master.mjs Demo)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FFMPEG = join(ROOT, "node_modules", "@remotion", `compositor-${process.platform === "win32" ? "win32-x64-msvc" : `${process.platform}-${process.arch}`}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const SRC = join(ROOT, "out", "Demo-master.mp4");
const OUT = join(ROOT, "out", "x");
mkdirSync(OUT, { recursive: true });

// [name, from, to] in seconds of the demo: its beats at 0:12.00 (the 13 seconds), 0:27.55 (the idea),
// 0:41.07 (live on mainnet), 1:30.57 (verify), 1:43.27 (photo finish)
const CLIPS = [
  ["demo-why-x.mp4", 12.0, 41.07],
  ["demo-live-x.mp4", 41.07, 90.57],
  ["demo-verify-x.mp4", 90.57, 103.27],
];
for (const [name, from, to] of CLIPS) {
  const d = (to - from).toFixed(3);
  const ease = `volume='if(lt(t,0.25),t/0.25,if(gt(t,${d}-0.5),max(0,(${d}-t)/0.5),1))':eval=frame`;
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(from), "-i", SRC, "-t", d, "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-af", ease, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", join(OUT, name)]);
  console.log(`${name}: ${d} s, ${(statSync(join(OUT, name)).size / 1024 / 1024).toFixed(1)} MB`);
}
