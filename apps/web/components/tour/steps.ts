import type { RegimeName } from "@unison/engine";

/**
 * The tour's stops, in reading order. Each lights one part of the terminal, marked in the markup with
 * `data-tour="<anchor>"`, and says what it is in a few true sentences. The words follow what is on screen: the
 * venue (a live network or the simulation), the market's regime, and the layout (a phone has no ticket column, so
 * its ticket stop lights the Buy and Sell bar instead).
 */
export type TourAnchor = "price" | "regime" | "strip" | "chart" | "ticket" | "outcome" | "thumb" | "account" | "activity";

export interface TourContext {
  ticker: string;
  /** a live network, not the simulation */
  live: boolean;
  /** the network as the venue pill names it ("Monad testnet"), when live */
  network: string | null;
  /** real assets and real money: the mainnet beta */
  mainnet: boolean;
  /** the network drips test funds */
  faucet: boolean;
  signedIn: boolean;
  regime: RegimeName;
  /** who is closed, while the market is: "Wall Street", for a stock */
  closedWho: string;
  /** blocks between auctions while closed, and that in seconds */
  discCadence: number;
  discSeconds: number;
  feeBps: number;
  /** the paper account's opening balance, in the simulation */
  paperQuote: number;
  /** a phone or tablet: no ticket column */
  compact: boolean;
  /** the replay shortcut, as this keyboard writes it */
  shortcut: string;
  /** stops after the welcome, on this layout */
  stops: number;
}

export interface TourStep {
  id: string;
  /** what is lit on wide screens; null is a card with nothing lit */
  wide: TourAnchor | null;
  /** on phones and tablets, if it differs: another anchor, or "skip" where the stop has nothing to show */
  compact?: TourAnchor | null | "skip";
  /**
   * how to bring it on screen: centred in the window, or the least scroll that shows it (for what is pinned: the
   * ticket column, the top bar, the Buy and Sell bar)
   */
  scroll: "center" | "nearest";
  title: (c: TourContext) => string;
  body: (c: TourContext) => string;
  /** a quiet line under the body */
  foot?: (c: TourContext) => string;
}

const REGIME: Record<RegimeName, (c: TourContext) => [string, string]> = {
  LIVE: () => [
    "Open: an auction every block",
    "While its market trades, every Monad block holds an auction, about 0.3 s apart. Each clears against a reference price read after the auction closes, so no order can be placed against it.",
  ],
  EXTENDED: () => [
    "Extended hours",
    "Pre-market or after hours: still an auction every block, about 0.3 s apart, in a wider band.",
  ],
  DISCOVERY: (c) => [
    `Closed: an auction every ${c.discSeconds} s`,
    `${c.closedWho} is closed, so there is no live price to copy. Orders gather for ${c.discCadence} blocks and clear together at one price, in a band around the last close that widens the longer it stays closed.`,
  ],
  REOPENING: () => [
    "The reopening cross",
    "The first auction after the close, in a wider band, so the opening price can be found.",
  ],
  HALTED: () => [
    "Halted",
    "Trading is paused, as it is on the primary market. You can still cancel orders, claim fills and withdraw.",
  ],
};

export const STEPS: TourStep[] = [
  {
    id: "welcome",
    wide: null,
    scroll: "center",
    title: () => "One price for everyone",
    body: (c) =>
      `Every order that trades in an auction trades at the same price, so being faster earns nothing. Here is how to read this screen and place an order, in ${c.stops} stops.`,
    foot: (c) =>
      c.mainnet
        ? `You're on ${c.network}: real assets and real money, in a small beta with daily caps. Not yet externally audited.`
        : c.live
          ? `You're on ${c.network ?? "a live network"}: real orders, with test money.`
          : "This is the simulation: the real clearing engine, in your browser, with paper money.",
  },
  {
    id: "price",
    wide: "price",
    scroll: "center",
    title: () => "The last trade",
    body: (c) =>
      `What ${c.ticker} last traded at, in AUSD, a dollar stablecoin. Beside it, the ${c.regime === "DISCOVERY" ? "last close" : "reference price"} and the band: the range the next auction may clear in.`,
  },
  {
    id: "regime",
    wide: "regime",
    scroll: "center",
    title: (c) => REGIME[c.regime](c)[0],
    body: (c) => REGIME[c.regime](c)[1],
  },
  {
    id: "strip",
    wide: "strip",
    scroll: "center",
    title: () => "The auction, as it forms",
    body: (c) =>
      c.compact
        ? "When the next auction runs, and the price it would clear at if it ran now. Details holds the vault's quote and the last trade."
        : "When the next auction runs, the price it would clear at if it ran now, the vault's bid and ask, and the last trade. The vault is the market's standing liquidity: it quotes a bid and an ask into the auction.",
  },
  {
    id: "chart",
    wide: "chart",
    scroll: "center",
    title: () => "Where buyers and sellers meet",
    body: () =>
      "One line counts the buyers at or above each price, the other the sellers at or below it. Where they cross is the price this auction clears at, and everyone who trades pays it. Your own order is drawn here as you set it.",
  },
  {
    id: "ticket",
    wide: "ticket",
    compact: "thumb",
    scroll: "nearest",
    title: () => "Your order",
    body: (c) =>
      c.compact
        ? "Buy or Sell opens the ticket. Set a limit, the most you'll pay or the least you'll take, and a quantity. Before you send it, the ticket shows what fills now and the most it can cost."
        : `Choose a side, then a limit: the most you'll pay, or the least you'll take. The chips set it to the last trade, the ${c.regime === "DISCOVERY" ? "close" : "reference"} or where it clears now. Then a quantity, and how long the order lives.`,
  },
  {
    id: "outcome",
    wide: "outcome",
    compact: "skip",
    scroll: "nearest",
    title: () => "Know before you send",
    body: (c) =>
      `The ticket runs the clearing engine on this auction with your order in it: what fills now, the most it can cost (or the least a sale brings) with the ${c.feeBps} bp fee, and what is held while it waits. Orders exactly at the clearing price share what's left, pro rata.`,
  },
  {
    id: "account",
    wide: "account",
    scroll: "nearest",
    title: (c) => (!c.live ? "A paper account" : c.signedIn ? "Your account" : "Your account is a passkey"),
    body: (c) =>
      !c.live
        ? `In the simulation you trade a paper account: ${c.paperQuote.toLocaleString("en-US")} AUSD and a few shares of each market. On a live network, you sign in here with a passkey.`
        : c.signedIn
          ? `Your free AUSD, signed in with your passkey. Open it for ${c.faucet ? "test funds and " : c.mainnet ? "a deposit from your wallet and " : ""}a trading session: one signature now, then one tap per order.`
          : `Face ID, Touch ID or Windows Hello: no seed phrase, and no gas to pay.${c.faucet ? " Once you're in, one tap adds test funds." : c.mainnet ? " Once you're in, you deposit AUSD from your own wallet." : ""}`,
  },
  {
    id: "activity",
    wide: "activity",
    scroll: "center",
    title: () => "Orders, fills, certificates",
    body: (c) =>
      `Your orders wait here until they fill, expire or you cancel them. Each fill opens a certificate of execution: the auction it cleared in and its one price${c.live ? ", checked against the venue's receipt chain" : ""}.`,
    foot: (c) => (c.compact ? `Replay this tour from "About ${c.ticker} on Unison", below.` : `Replay this tour any time: ${c.shortcut}, then Take the tour.`),
  },
];

export interface PlannedStep {
  step: TourStep;
  anchor: TourAnchor | null;
}

/** The stops on this layout, each with the anchor it lights. */
export function stepsFor(compact: boolean, steps: TourStep[] = STEPS): PlannedStep[] {
  const out: PlannedStep[] = [];
  for (const step of steps) {
    const anchor = compact && step.compact !== undefined ? step.compact : step.wide;
    if (anchor === "skip") continue;
    out.push({ step, anchor });
  }
  return out;
}
