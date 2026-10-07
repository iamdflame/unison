/**
 * Renders stills of a composition at the given seconds, bundling once: the quick way to look at a cut.
 *
 *   node capture/stills.mjs Pitch 3 10 42.5     (from video/; writes out/<Composition>-<seconds>.jpg)
 */
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [id, ...at] = process.argv.slice(2);
if (!id || !at.length) throw new Error("usage: node capture/stills.mjs <Composition> <seconds> [seconds…]");
const serveUrl = await bundle({ entryPoint: join(ROOT, "src", "index.ts"), publicDir: join(ROOT, "public") });
const composition = await selectComposition({ serveUrl, id, logLevel: "error" });
for (const sec of at) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(Number(sec) * composition.fps));
  const output = join(ROOT, "out", `${id}-${sec}.jpg`);
  await renderStill({ serveUrl, composition, frame, output, imageFormat: "jpeg", jpegQuality: 85, logLevel: "error" });
  console.log(`${id} ${sec} s (frame ${frame}) → out/${id}-${sec}.jpg`);
}
