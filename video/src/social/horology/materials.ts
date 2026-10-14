/**
 * The two lights of the house (apps/web/app/globals.css): Porcelain while Wall Street trades, Nocturne while it's
 * closed. Ink, accent, champagne and the buy/sell pair are the site's own token values; the rest are the materials the
 * design system names for its imagery (porcelain enamel, blued steel, sapphire, champagne), mixed for a lit object.
 */
export type Finish = "porcelain" | "nocturne";

export interface Light {
  /** the ground the object rests on, at the key light and at the edge of its falloff */
  ground: string;
  groundEdge: string;
  ink: string;
  ink2: string;
  ink3: string;
  /** blued steel by day, lume by night */
  accent: string;
  champagne: string;
  sell: string;
  buy: string;
  /** the colour a cast shadow takes on this ground */
  shadow: string;
}

export const LIGHT: Record<Finish, Light> = {
  porcelain: {
    ground: "oklch(0.958 0.007 80)",
    groundEdge: "oklch(0.885 0.009 76)",
    ink: "oklch(0.19 0.012 262)",
    ink2: "oklch(0.43 0.012 262)",
    ink3: "oklch(0.5 0.01 262)",
    accent: "oklch(0.4 0.15 266)",
    champagne: "oklch(0.58 0.06 80)",
    sell: "oklch(0.47 0.12 34)",
    buy: "oklch(0.48 0.095 185)",
    shadow: "oklch(0.32 0.02 60)",
  },
  nocturne: {
    ground: "oklch(0.2 0.022 262)",
    groundEdge: "oklch(0.085 0.01 265)",
    ink: "oklch(0.95 0.006 250)",
    ink2: "oklch(0.78 0.01 255)",
    ink3: "oklch(0.66 0.01 255)",
    accent: "oklch(0.74 0.085 266)",
    champagne: "oklch(0.82 0.05 85)",
    sell: "oklch(0.66 0.115 33)",
    buy: "oklch(0.76 0.085 180)",
    shadow: "oklch(0.02 0.01 265)",
  },
};

/** Material stops, light to dark, for gradients that read as a surface catching a softbox. */
export const MAT = {
  /** polished steel: bands of softbox and studio dark, for a conic bezel */
  steel: ["#f6f7f9", "#a2a8b1", "#e6e9ed", "#5c636d", "#cfd3d8", "#fafbfc", "#7b828c", "#dde0e4", "#4d535b", "#c4c8ce"],
  /** steel at night: the same bands, lit only by a cool rim */
  steelNight: ["#7d8796", "#2a3039", "#5b6573", "#14181e", "#4a5360", "#9aa5b4", "#232830", "#56606d", "#101318", "#3c4450"],
  /** blued steel, across the width of a hand: dark flanks, a bright ridge where the light runs */
  blued: ["#081640", "#132f86", "#3f6fe0", "#9db8ff", "#2f5bd0", "#10287a", "#071338"],
  /** champagne gold, across a hand */
  gold: ["#5e4320", "#9c7a44", "#e8d29c", "#fff2cf", "#c8a865", "#86662f", "#4f3818"],
  /** grand-feu enamel: warm white, its glaze, and the shade where it meets the flange */
  enamel: { face: "#f8f5ef", glaze: "#fffefb", shade: "#e4ded2" },
  /** night enamel, blued */
  nightEnamel: { face: "#14244f", glaze: "#25397a", shade: "#070d22" },
  /** sealing wax: oxblood to garnet, lit */
  wax: { body: "#8a1c26", lit: "#c43a44", deep: "#4a0b12" },
  /** Super-LumiNova as it glows, ice blue (the night accent) */
  lume: "#cfe6ff",
  lumeGlow: "rgba(150, 200, 255, 0.55)",
  /** printing on enamel: blued ink, the way a dial's track is printed */
  print: "#1b2f7a",
  /** certificate stock */
  paper: "#fbf9f3",
  paperEdge: "#efeadf",
};
