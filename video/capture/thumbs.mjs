/**
 * Renders the uploads' thumbnails (src/thumbs/Thumbs.tsx) to out/thumbs/<Film>.png at 1280 × 720. YouTube takes a
 * thumbnail up to 2 MB: a PNG over that is written as a JPEG instead.
 *
 *   node capture/thumbs.mjs [Demo Pitch …]      (from video/; all six by default)
 */
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FFMPEG = join(ROOT, "node_modules", "@remotion", `compositor-${process.platform === "win32" ? "win32-x64-msvc" : `${process.platform}-${process.arch}`}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const films = process.argv.slice(2).length ? process.argv.slice(2) : ["Demo", "Pitch", "Ad", "MetaMask", "Cre", "Envio"];
const OUT = join(ROOT, "out", "thumbs");
mkdirSync(OUT, { recursive: true });
// the demo's thumbnail shows the certificate the site issued for the film's buy: cut from the 4K take (04-certificate,
// 6 s in, the modal alone), like the rest of the footage kept out of git
const CERT = join(ROOT, "public", "thumbs", "certificate.png");
if (!existsSync(CERT)) {
  mkdirSync(join(ROOT, "public", "thumbs"), { recursive: true });
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-ss", "6.0", "-i", join(ROOT, "public", "footage", "04-certificate.mp4"), "-frames:v", "1", "-vf", "crop=1524:1118:1158:522", CERT]);
}
const serveUrl = await bundle({ entryPoint: join(ROOT, "src", "index.ts"), publicDir: join(ROOT, "public") });
for (const film of films) {
  const composition = await selectComposition({ serveUrl, id: `Thumb${film}`, logLevel: "error" });
  const png = join(OUT, `${film}.png`);
  await renderStill({ serveUrl, composition, output: png, imageFormat: "png", logLevel: "error" });
  const size = statSync(png).size;
  if (size <= 2 * 1024 * 1024) {
    console.log(`${film}: out/thumbs/${film}.png (${(size / 1024).toFixed(0)} KB)`);
    continue;
  }
  const jpg = join(OUT, `${film}.jpg`);
  await renderStill({ serveUrl, composition, output: jpg, imageFormat: "jpeg", jpegQuality: 92, logLevel: "error" });
  rmSync(png);
  console.log(`${film}: out/thumbs/${film}.jpg (${(statSync(jpg).size / 1024).toFixed(0)} KB; the PNG was over 2 MB)`);
}
