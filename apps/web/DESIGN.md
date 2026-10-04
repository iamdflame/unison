# Unison design system: Horology

Unison is the market that never closes. Every 300 ms (one Monad block), every order in a market clears at one price, inside a band around a reference published after the batch closed. In music, unison means many voices on one pitch. The design borrows the vocabulary of fine watchmaking, the craft built on one steady beat:

| Watch term | On Unison |
|---|---|
| Beat | the 300 ms batch |
| Movement | the contracts |
| Power reserve: ∞ | never closes |
| Complications | discovery, reopening, halts, the Chainlink audit |
| Lume | the night light |
| Hacking seconds | a halted market |

Use one metaphor per section at most. The product's truth comes before the metaphor.

This file is canonical. Tokens live in `app/globals.css` (CSS) and `lib/motion/tokens.ts` (TypeScript); the `/brand` page renders the system live from those same tokens, and `/lab` is the component gallery.

## Principles

1. **Truth first.** Every number on the site comes from `lib/content/facts.ts`, which `test/facts.test.ts` checks against `docs/evidence/`. Simulated data says "Simulation". Test networks and mock assets are labelled. "Not yet externally audited" stays visible.
2. **The light follows the market.** Porcelain (day) while Wall Street trades, Nocturne (night) while it is closed. Both are first-class: design and review every screen in both.
3. **Instruments, not paragraphs.** Explain with a dial, a chart or something to press. One exact line beats a paragraph.
4. **Restraint.** One idea per screen. Nothing decorative without a job. Generous space.
5. **Accessible by construction.** WCAG 2.2 AA, complete by keyboard, respecting reduced motion and reduced transparency, never flashing.

## Brand

**The mark is a tuning fork shaped as a U.** Two tines (buyers and sellers) meet at one point and stand on one stem, the reference pitch everyone tunes to. The ball is the single price.

- It is drawn on a 48-unit grid in three optical masters: display (44 px and up), text (20 to 44 px) and heavy (20 px and below, snapped to the pixel grid). `components/brand/master.ts` picks one from the rendered size.
- `StaticEmblem` draws it where it holds still (navigation, headers). It has no hooks, so a server component renders it and the path data reaches the page as markup, not JavaScript. `Emblem` is the client component for the places it moves: `ref.strike()` flexes the tines in antiphase, at most 1 px, settling within about 800 ms. It plays on an event (a print, a fill), never in a loop.
- **The wordmark** is UNISON in spaced Didone capitals: Bodoni Moda outlined and hand-kerned, in three masters (display, mid, text). `Lockup` sets mark and wordmark on one baseline, the stem hanging below it like a descender.
- **The geometry is generated.** `scripts/brand/build.mjs` writes `components/brand/geometry.ts` (the mark) and `glyphs.ts` (the wordmark), plus every exported asset in `public/brand/`. Run it with `GEOMETRY_ONLY=1` to rewrite just the two modules.
- Never stretch, outline or add effects to the mark, and never set it on busy imagery. Minimum size is 16 px. Clear space equals the gap between the tines.
- Imagery is generated, never stock: guilloché engraving, dials, the exploded movement. `/brand` has the downloads.

## Color

Components use semantic tokens only. Tailwind's default palette is removed (`text-red-500` does not exist), and a component never hard-codes a color.

| Token | Role |
|---|---|
| `bg`, `raised`, `sunken` | page, cards, wells |
| `ink`, `ink-2`, `ink-3` | text: primary, secondary, tertiary |
| `line`, `line-strong` | hairlines (structure comes from hairlines; elevation from shadow) |
| `accent`, `accent-ink`, `accent-soft` | blued steel by day, lume (ice blue) by night |
| `buy`, `sell`, `buy-soft`, `sell-soft`, `buy-fill`, `sell-fill` | sides of the market: text, tints, filled buttons |
| `halt` | a halted market |
| `champagne` | the band arc, hairline engraving |
| `engrave` | text cut into a surface (the footer wordmark) |
| `glass`, `scrim` | the one translucent layer; behind dialogs |
| `ball-1` to `ball-4` | the mark's ball: heat-blued steel by day, lume by night |

- **Buy and sell** come in two palettes: verdigris and garnet (house), and steel and amber for color-vision deficiencies. The visitor picks one in the light switch (Appearance, then Buy and sell). Each light defines both palettes as data (`--buy-std`, `--buy-cvd` and so on); the tints derive from the active pair with `color-mix`, so everything switches together. Buy and sell always carry a word or a glyph as well as a color.
- **Contrast is tested, not eyeballed.** `test/contrast.test.ts` reads the token blocks out of `globals.css` and checks every text pair, the labels on the buy and sell buttons, and buy/sell separation under protanopia, deuteranopia and tritanopia, in all four light and palette combinations.
- **The light.** The default mode, "Market hours", is day while the US equity session is open or extended and night while it is closed; the switch also offers Day, Night and System. `lib/theme/script.ts` sets `data-theme` before first paint, so the page never flashes the wrong light. A change of light crossfades through a view transition where the browser has one.

## Type

| Face | Use | Utilities |
|---|---|---|
| Bodoni Moda (variable optical size) | display, never below 28 px, never an italic accent word | `text-display-xxl`, `xl`, `l`, `m` |
| Bodoni Moda at a sturdier cut | large engraved figures (prices in dials) | `numerals` |
| Mona Sans (variable width) | everything else: 16/24 text, 14/20 and 13/18 in the app | `text-lede`, `dial-label` |
| Fragment Mono | hashes and addresses only, truncated in the middle | `font-mono` |

- Display type takes the optical size of its rendered size. On 1x screens it uses a sturdier cut, because hairlines drawn for large sizes vanish at 28 to 60 px there.
- **`tnum` or `figures`.** Use tabular figures (`tnum`) wherever digits align in a column, tick live, or sit in an input. Mona Sans draws its tabular zero slashed. A standalone amount that does not move uses `figures`: proportional, with an open zero.
- `dial-label` is the wide cut of Mona Sans, for tiny instrument labels (BATCH, BAND) only, never for section headers.

## Space, shape and materials

- A 4-point grid. Radii are `xs 6`, `sm 10`, `md 14`, `lg 20`, `xl 28` and `2xl 36`. Nested shapes are concentric: outer radius = inner radius + padding.
- Shadows `shadow-sm`, `md` and `lg` are layered and neutral by day; by night they are an inset highlight, a hairline ring and a deep drop.
- **Glass** (`glass`) is a 20 px blur with 180% saturation over a tinted fill, opaque under reduced transparency. Use one translucent layer at a time. In any rule with a prefixed pair, declare `-webkit-backdrop-filter` first and `backdrop-filter` last. The compiler keeps only the last of the pair and Chrome ignores the prefixed form, so the other order draws no blur in Chrome.
- Engraved, not printed: large brand type on a surface is cut at engraving strength (`text-engrave`).

## Motion

**The purpose test.** Every motion answers at least one question: what changed, where it came from, or what is next. If it answers none, cut it.

| Interaction | Duration | Easing |
|---|---|---|
| Press | 100 to 160 ms, scale 0.96 on pointer-down (`press`) | out |
| Tooltip | 125 to 200 ms | out |
| Popover, menu | 150 to 250 ms, from the trigger (`transform-origin`) | out |
| Drawer | about 280 ms | drawer |
| Dialog | 200 to 300 ms | out |
| Marketing scene | 700 to 1200 ms, scrubbed by scroll or played once | in-out |

Easings: out `(.23,1,.32,1)`, in-out `(.77,0,.175,1)`, drawer `(.32,.72,0,1)`, standard `(.2,0,0,1)`. Never ease-in for UI.

**Rules:**
- Animate transform, opacity, filter and clip-path only. Never scale from 0: enter from 0.95 with opacity.
- Prefer interruptible CSS transitions for state, and use keyframes only for one-shot sequences. Exits are softer and shorter than entrances.
- Hover effects live under the `hover-fine:` variant (a fine pointer that can hover).
- Never fade-slide every section up. Choose a reveal per section: a clip-path wipe, blur to sharp, a hairline drawing on.
- **The beat is geometry, never a flash.** The 3.33 Hz beat moves a hand or locks rings into phase; it never pulses brightness (WCAG 2.3.1 allows at most three flashes a second). Between beats, nothing moves.
- Every motion has a static cue as well (a color, a glyph, a word).
- Reduced motion: crossfades of 150 ms or less; scroll scenes show their finished state; strikes become still.

**How it is built.** UI motion uses CSS transitions and WAAPI. There is no animation library:

| Need | Tool |
|---|---|
| A scene tied to scroll (the exploded movement) | `useScrollProgress`: one measurement per frame, only while the scene is near the viewport |
| Smooth wheel scrolling on marketing pages | Lenis, fetched after the page is interactive, off for coarse pointers and reduced motion |
| Live numbers | NumberFlow. It animates custom properties on the main thread, so reserve it for numbers that matter. |
| Dialogs, menus, tabs | Base UI, restyled |
| Toasts | Sonner, behind `lib/ui/toast.ts` |
| Command palette | cmdk |

**Motion that stays cheap.**
- Animate HTML layers, not the insides of a big SVG. Transforms on SVG children repaint the whole SVG on every frame. The hero dial keeps its 200-step track in a memoized SVG that paints once; its pointer and print dots ride their own layers, so their rotation and fades run on the compositor.
- On a long page, a section far below the fold gets `defer-paint` (`content-visibility: auto` with a remembered height). The browser then skips styling and laying it out until it approaches the viewport.
- At rest a page should be idle between beats. `scripts/rest.mjs` lists anything that is not: each running animation, whether the compositor could take it, and who keeps requesting frames.

## Interaction

- Respond on pointer-down. Touch targets are at least 44 px (the `tap` utility enlarges the hit area without changing the look).
- Design every state: hover, focus-visible, active, disabled, loading (show progress after a second), empty, error, success, offline.
- Errors are sentences with a way out. Venue reverts go through the SDK's decoder (`describeError`).
- Numbers never jump in width: use `tnum`, and NumberFlow for changes.
- Live regions: one polite announcer. Never announce every beat or print.
- **Controls whose code arrives late.** Menus, sheets and dialogs load after the page is interactive (see Performance). Until then, a standby button draws the trigger. It hands over a press or a focus that arrives before the code, so the press still lands (`themeHandoff` in `components/ui/ThemeMenu.tsx`).

## Copy

- Sentence case. Plain and precise. Numbers instead of adjectives. No em dashes, no emoji.
- No hype words ("revolutionize", "unlock", "seamless", "empower", "next-gen").
- Say what is true now; label what is simulated or still coming.

**Reject these on sight (the AI defaults):**
- Inter, Geist or Instrument Serif; a serif italic accent word inside a sans headline.
- Indigo-to-purple gradients, colored glows, cream with terracotta, near-black with acid green.
- A badge above a centered headline, three identical icon cards, a row of big stats, numbered 1-2-3 steps.
- All-caps section eyebrows, colored card borders, fade-up on every section, bouncy UI springs, infinite decorative loops.
- Fake window chrome (traffic-light dots) on a terminal.

## Performance

Budgets, measured from production builds:

| Measure | Budget | Tool |
|---|---|---|
| First-load JS, marketing pages | 180 KB gzip | `node scripts/weigh.mjs --check` |
| First-load JS, app screens | 250 KB gzip | same |
| LCP, mid-tier phone (4x CPU, 9 Mbps) | under 2.0 s | `node scripts/vitals.mjs` |
| CLS | under 0.05 | same |

**How the budgets are kept:**
- **Signing loads when a signature is near.** `lib/venue/signer.ts` holds viem, the curves, the ABIs and the error decoder. `identity.ts` keeps only the state and forwards to it. Signed-in traders fetch it while the page is idle; the sign-in sheet fetches it as it opens, so a passkey prompt never waits on the network.
- **Watching is light.** The tape is plain fetch and server-sent events, and the two chain reads (depth, balances) are hand-encoded `eth_call`s through the SDK's `LightReader`.
- **The server draws what never moves:** brand art, page titles, static notes. Client components receive them as props or children.
- **Popups arrive after hydration.** `preloadable()` in `lib/ui/lazy.ts` handles anything else that is only sometimes needed.
- **Each app screen starts its download with the page's own scripts** (`components/app/screens/early.ts`), and its skeleton holds the exact size of the real content, so nothing below it moves when it arrives.

**Tools** (`scripts/`):

| Script | What it answers |
|---|---|
| `weigh.mjs` | First-load JS per route against its budget, attributed to packages or files through the build's source maps (`SOURCE_MAPS=1 pnpm build`) |
| `vitals.mjs` | LCP, CLS, blocking time, and JS on the wire before and after the load event |
| `profile.mjs` | Where the main thread goes, by original source file |
| `frames.mjs` | What the renderer does at rest; with `--load`, each long task and what filled it |
| `rest.mjs` | What keeps a page busy when nobody touches it |
| `shoot.mjs` | Screenshots at any width and light, after interactions, and motion frame by frame at a slowed playback rate |
| `axe.mjs` | WCAG 2.2 A/AA on every route in both lights |
| `flow-*.mjs` | The live flows on the local devnet (passkey to certificate, portfolio and withdrawal, agent keys through MCP, the shell's lazy controls) |

## Review

1. Look at every screen at 390, 834, 1280 and 1440 px, by day and by night, with motion on and with reduced motion (`node scripts/shoot.mjs /route --theme night --width 390`).
2. Replay motion at 10% speed (`--rate 0.1 --frames 8`).
3. Report one row per root cause, with every `file:line`:

   | Severity | Before | After | Why |
   |---|---|---|---|

   **HIGH** breaks interaction, accessibility or truth. **MEDIUM** is a visible inconsistency. **LOW** is polish.
4. End with **Block** if any HIGH remains, otherwise **Approve**.

## Where things live

```
app/(marketing)/   home, fairness, developers, status, brand, legal          server pages with client islands
app/(app)/         trade, markets, portfolio, vaults, keys                   the app shell and its screens
components/brand/  mark, wordmark, lockup, dials                             geometry.ts and glyphs.ts are generated
components/app/    shell (top bar, tab bar, sign-in, ⌘K) and screens/
components/ui/     light switch, toaster
components/motion/ scroll progress, in-view, smooth scroll
lib/venue/         live venue (tape, light reads), identity, signer (on demand), chain (on demand)
lib/demo/, lib/sim/  the in-browser simulation on the real clearing engine
lib/theme/         modes, palette, the pre-paint script
lib/content/       facts (tested against docs/evidence), markets, site
```
