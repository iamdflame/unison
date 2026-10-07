/**
 * The X account's assets (@unison_fi) into out/x/: the avatar (1000 × 1000; X shows it at 400 in a circle), the
 * header (1500 × 500), the post cards (1600 × 900), and each film X can take natively (a free account plays up to
 * 2:20) re-encoded at 30 fps H.264 + AAC, which every X client accepts. The demo (2:32) is linked, not uploaded.
 *
 *   node capture/social.mjs            (from video/, after node capture/master.mjs …)
 */
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FFMPEG = join(ROOT, "node_modules", "@remotion", `compositor-${process.platform === "win32" ? "win32-x64-msvc" : `${process.platform}-${process.arch}`}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const OUT = join(ROOT, "out", "x");
mkdirSync(OUT, { recursive: true });

const serveUrl = await bundle({ entryPoint: join(ROOT, "src", "index.ts"), publicDir: join(ROOT, "public") });
for (const [id, file] of [
  ["XAvatar", "avatar.png"],
  ["XHeader", "header.png"],
  ["XHow", "card-how.png"],
  ["XWeek", "card-week.png"],
]) {
  const composition = await selectComposition({ serveUrl, id, logLevel: "error" });
  await renderStill({ serveUrl, composition, output: join(OUT, file), imageFormat: "png", logLevel: "error" });
  console.log(`${file}: ${composition.width} × ${composition.height}, ${(statSync(join(OUT, file)).size / 1024).toFixed(0)} KB`);
}

const seconds = (file) => {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = (r.stderr ?? "").match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Infinity;
};
for (const film of ["Ad", "MetaMask", "Cre", "Envio", "Pitch"]) {
  const src = join(ROOT, "out", `${film}-master.mp4`);
  if (!existsSync(src)) {
    console.log(`${film}: no master yet, skipped`);
    continue;
  }
  const len = seconds(src);
  if (len > 140) {
    console.log(`${film}: ${len.toFixed(1)} s is past a free account's 2:20, skipped`);
    continue;
  }
  const dst = join(OUT, `${film.toLowerCase()}-x.mp4`);
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", dst]);
  console.log(`${film}: ${len.toFixed(1)} s → out/x/${film.toLowerCase()}-x.mp4 (${(statSync(dst).size / 1024 / 1024).toFixed(1)} MB, 30 fps)`);
}
