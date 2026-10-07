import { Composition } from "remotion";
import { FPS, H, s, W } from "./brand";
import { Ad, planAd } from "./films/Ad";
import { Demo, planDemo } from "./films/Demo";
import { Pitch, planPitch } from "./films/Pitch";
import { loadFonts } from "./fonts";
import { Agent } from "./scenes/Agent";
import { BrandTest } from "./scenes/BrandTest";
import { Challenge } from "./scenes/Challenge";
import { Close } from "./scenes/Close";
import { ColdOpen } from "./scenes/ColdOpen";
import { Idea } from "./scenes/Idea";
import { Live, LIVE_FRAMES } from "./scenes/Live";
import { PhotoFinish } from "./scenes/PhotoFinish";
import { Thirteen } from "./scenes/Thirteen";
import { Verify } from "./scenes/Verify";

loadFonts();

const scene = (id: string, component: React.FC, sec: number) => (
  <Composition key={id} id={id} component={component} durationInFrames={s(sec)} fps={FPS} width={W} height={H} />
);

export const Root = () => (
  <>
    {/* the films: their length comes from the voice files in public/audio (estimated until they exist) */}
    <Composition
      id="Demo"
      component={Demo}
      fps={FPS}
      width={W}
      height={H}
      durationInFrames={s(150)}
      defaultProps={{ beats: [], music: null, cues: [] }}
      calculateMetadata={async () => {
        const { durationInFrames, ...props } = await planDemo();
        return { durationInFrames, props };
      }}
    />
    <Composition
      id="Pitch"
      component={Pitch}
      fps={FPS}
      width={W}
      height={H}
      durationInFrames={s(110)}
      defaultProps={{ beats: [], music: null, cues: [] }}
      calculateMetadata={async () => {
        const { durationInFrames, ...props } = await planPitch();
        return { durationInFrames, props };
      }}
    />
    <Composition
      id="Ad"
      component={Ad}
      fps={FPS}
      width={W}
      height={H}
      durationInFrames={s(21)}
      defaultProps={{ beats: [], music: null, cues: [] }}
      calculateMetadata={async () => {
        const { durationInFrames, ...props } = await planAd();
        return { durationInFrames, props };
      }}
    />
    {/* the scenes, one by one */}
    {scene("BrandTest", BrandTest, 4)}
    {scene("ColdOpen", ColdOpen, 12)}
    {scene("Thirteen", Thirteen, 14)}
    {scene("Idea", Idea, 12)}
    <Composition id="Live" component={Live} durationInFrames={LIVE_FRAMES} fps={FPS} width={W} height={H} />
    {scene("Verify", Verify, 12)}
    {scene("PhotoFinish", PhotoFinish, 13)}
    {scene("Challenge", Challenge, 8)}
    {scene("Agent", Agent, 11)}
    {scene("Close", Close, 8)}
  </>
);
