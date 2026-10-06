import { Composition } from "remotion";
import { FPS, H, s, W } from "./brand";
import { loadFonts } from "./fonts";
import { Agent } from "./scenes/Agent";
import { BrandTest } from "./scenes/BrandTest";
import { Challenge } from "./scenes/Challenge";
import { Close } from "./scenes/Close";
import { ColdOpen } from "./scenes/ColdOpen";
import { Idea } from "./scenes/Idea";
import { PhotoFinish } from "./scenes/PhotoFinish";
import { Thirteen } from "./scenes/Thirteen";
import { Verify } from "./scenes/Verify";

loadFonts();

const scene = (id: string, component: React.FC, sec: number) => (
  <Composition key={id} id={id} component={component} durationInFrames={s(sec)} fps={FPS} width={W} height={H} />
);

export const Root = () => (
  <>
    {scene("BrandTest", BrandTest, 4)}
    {scene("ColdOpen", ColdOpen, 12)}
    {scene("Thirteen", Thirteen, 14)}
    {scene("Idea", Idea, 12)}
    {scene("Verify", Verify, 12)}
    {scene("PhotoFinish", PhotoFinish, 13)}
    {scene("Challenge", Challenge, 8)}
    {scene("Agent", Agent, 11)}
    {scene("Close", Close, 8)}
  </>
);
