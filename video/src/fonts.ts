import { continueRender, delayRender, staticFile } from "remotion";

/** The brand's fonts (SIL OFL, public/fonts/LICENSE.md), loaded before any frame is drawn. */
const FACES: [family: string, file: string, weight: number][] = [
  ["Bodoni Display", "BodoniModa-96-400.ttf", 400],
  ["Bodoni Display", "BodoniModa-96-500.ttf", 500],
  ["Bodoni Small", "BodoniModa-40-550.ttf", 550],
  ["Bodoni Small", "BodoniModa-24-600.ttf", 600],
  ["Mona Sans", "MonaSans-400.ttf", 400],
  ["Mona Sans", "MonaSans-600.ttf", 600],
  ["Mona Sans Wide", "MonaSans-Wide-600.ttf", 600],
  ["Fragment Mono", "FragmentMono-Regular.ttf", 400],
];

let loaded = false;
export function loadFonts() {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  const handle = delayRender("brand fonts");
  Promise.all(
    FACES.map(async ([family, file, weight]) => {
      const face = new FontFace(family, `url(${staticFile(`fonts/${file}`)})`, { weight: String(weight) });
      await face.load();
      (document.fonts as unknown as { add(f: FontFace): void }).add(face);
    }),
  )
    .then(() => continueRender(handle))
    .catch((e) => {
      console.error(e);
      continueRender(handle);
    });
}
