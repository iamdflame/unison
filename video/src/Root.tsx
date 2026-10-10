import { Composition, Still } from "remotion";
import { FPS, H, s, W } from "./brand";
import { Ad, planAd } from "./films/Ad";
import { Cre, planCre } from "./films/Cre";
import { Demo, planDemo } from "./films/Demo";
import { Envio, planEnvio } from "./films/Envio";
import { MetaMask, planMetaMask } from "./films/MetaMask";
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
import { XAvatar, XHeader, XHow, XPowers, XWeek } from "./social/X";
import { TH, ThumbAd, ThumbCre, ThumbDemo, ThumbEnvio, ThumbMetaMask, ThumbPitch, TW } from "./thumbs/Thumbs";

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
    <Composition
      id="MetaMask"
      component={MetaMask}
      fps={FPS}
      width={W}
      height={H}
      durationInFrames={s(75)}
      defaultProps={{ beats: [], music: null, cues: [] }}
      calculateMetadata={async () => {
        const { durationInFrames, ...props } = await planMetaMask();
        return { durationInFrames, props };
      }}
    />
    <Composition
      id="Cre"
      component={Cre}
      fps={FPS}
      width={W}
      height={H}
      durationInFrames={s(61)}
      defaultProps={{ beats: [], music: null, cues: [] }}
      calculateMetadata={async () => {
        const { durationInFrames, ...props } = await planCre();
        return { durationInFrames, props };
      }}
    />
    <Composition
      id="Envio"
      component={Envio}
      fps={FPS}
      width={W}
      height={H}
      durationInFrames={s(45)}
      defaultProps={{ beats: [], music: null, cues: [] }}
      calculateMetadata={async () => {
        const { durationInFrames, ...props } = await planEnvio();
        return { durationInFrames, props };
      }}
    />
    {/* the scenes, one by one */}
    {scene("BrandTest", BrandTest, 4)}
    {scene("ColdOpen", ColdOpen, 12)}
    {scene("Thirteen", Thirteen, 14)}
    {scene("Idea", Idea, 12)}
    <Composition id="Live" component={Live} durationInFrames={LIVE_FRAMES} fps={FPS} width={W} height={H} />
    {/* the uploads' thumbnails (1280 × 720): node capture/thumbs.mjs */}
    <Still id="ThumbDemo" component={ThumbDemo} width={TW} height={TH} />
    <Still id="ThumbPitch" component={ThumbPitch} width={TW} height={TH} />
    <Still id="ThumbAd" component={ThumbAd} width={TW} height={TH} />
    <Still id="ThumbMetaMask" component={ThumbMetaMask} width={TW} height={TH} />
    <Still id="ThumbCre" component={ThumbCre} width={TW} height={TH} />
    <Still id="ThumbEnvio" component={ThumbEnvio} width={TW} height={TH} />
    {/* the X account (@unison_fi): node capture/social.mjs */}
    <Still id="XAvatar" component={XAvatar} width={1000} height={1000} />
    <Still id="XHeader" component={XHeader} width={1500} height={500} />
    <Still id="XHow" component={XHow} width={1600} height={900} />
    <Still id="XWeek" component={XWeek} width={1600} height={900} />
    <Still id="XPowers" component={XPowers} width={1600} height={900} />
    {scene("Verify", Verify, 12)}
    {scene("PhotoFinish", PhotoFinish, 13)}
    {scene("Challenge", Challenge, 8)}
    {scene("Agent", Agent, 11)}
    {scene("Close", Close, 8)}
  </>
);
