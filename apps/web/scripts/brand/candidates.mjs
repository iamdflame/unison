/** Logo candidates per exploration round. Each round is judged; the next round refines the survivors. */

export const ROUNDS = {

  1: [

    { id: "A Â· monoline", note: "flat tips, gap 12, stroke 6", params: {} },

    { id: "B Â· open", note: "gap 14, stroke 5.5", params: { gap: 14, stroke: 5.5, stemWidth: 5.5 } },

    { id: "C Â· tight", note: "gap 10, stroke 6.5, tines 20", params: { gap: 10, stroke: 6.5, stemWidth: 6.5, tine: 20 } },

    { id: "D Â· didone", note: "hairline serifs on the tines", params: { terminal: "serif" } },

    { id: "E Â· didone + ball", note: "serifs, ball terminal", params: { terminal: "serif", stemEnd: "ball", stem: 9 } },

    { id: "F Â· ball", note: "resonator ball on the stem", params: { stemEnd: "ball", stem: 9 } },

    { id: "G Â· jewel", note: "a jewel at the join (the one price)", params: { jewel: "dot" } },

    { id: "H Â· jewel ring", note: "ring jewel", params: { jewel: "ring", jewelRadius: 4 } },

    { id: "I Â· soft", note: "round tips, ball", params: { terminal: "round", stemEnd: "ball", stem: 9 } },

    { id: "J Â· taper", note: "stem tapers to a point", params: { stemEnd: "taper", stem: 14 } },

    { id: "K Â· maison", note: "serifs, jewel, ball", params: { terminal: "serif", jewel: "dot", stemEnd: "ball", stem: 9 } },

    { id: "L Â· short stem", note: "reads U first", params: { stem: 8 } },

    { id: "M Â· long stem", note: "reads fork first", params: { stem: 16, tine: 16 } },

    { id: "N Â· fine", note: "stroke 4.5, gap 13", params: { stroke: 4.5, gap: 13, stemWidth: 4.5 } },

    { id: "O Â· bold", note: "stroke 7.5, gap 10", params: { stroke: 7.5, gap: 10, stemWidth: 7.5 } },

    { id: "P Â· didone taper jewel", note: "serifs, jewel, tapered stem", params: { terminal: "serif", jewel: "dot", stemEnd: "taper", stem: 14 } },

  ],

  2: [

    { id: "D · didone (r1)", note: "reference from round 1", params: { terminal: "serif" } },

    { id: "D1 · fine", note: "stroke 5, gap 13, stem 4.5 × 11", params: { terminal: "serif", stroke: 5, gap: 13, stemWidth: 4.5, stem: 11 } },

    { id: "D2 · contrast", note: "bend thins to a 1.4 hairline", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4.5, stem: 11, bowlHairline: 1.4 } },

    { id: "D3 · contrast 2.2", note: "gentler stress", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4.5, stem: 11, bowlHairline: 2.2 } },

    { id: "D4 · foot", note: "a Didone foot on the stem", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4.5, stem: 10, stemEnd: "serif" } },

    { id: "D5 · contrast + foot", note: "the fork as a letter", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4.5, stem: 10, stemEnd: "serif", bowlHairline: 1.6 } },

    { id: "E1 · fine ball", note: "serifs, small resonator ball", params: { terminal: "serif", stroke: 5, gap: 13, stemWidth: 4, stem: 8, stemEnd: "ball", ballRadius: 3.8 } },

    { id: "E2 · contrast ball", note: "stress + ball", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4, stem: 8, stemEnd: "ball", ballRadius: 3.9, bowlHairline: 1.8 } },

    { id: "N1 · hairline serif fine", note: "stroke 4.5, gap 13", params: { terminal: "serif", stroke: 4.5, gap: 13, stemWidth: 4, stem: 11, serifHeight: 1 } },

    { id: "D6 · wide", note: "gap 15: reads U first", params: { terminal: "serif", stroke: 5.5, gap: 15, stemWidth: 4.5, stem: 10 } },

    { id: "D7 · short", note: "stem 8: a letter with a descender", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4.5, stem: 8 } },

    { id: "D8 · thin stem", note: "stem 3.5: a fine handle", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 3.5, stem: 11 } },

  ],
  3: [
    { id: "R1 · resonance", note: "serifs, stressed bowl, stem 4 x 10, ball 3.4", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4, stem: 10, stemEnd: "ball", ballRadius: 3.4, bowlHairline: 1.8 } },
    { id: "R2 · smaller ball", note: "ball 3.0, stem 11", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4, stem: 11, stemEnd: "ball", ballRadius: 3.0, bowlHairline: 1.8 } },
    { id: "R3 · necked ball", note: "the stem flares into the ball", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 3.6, stem: 9, stemEnd: "ball", ballRadius: 3.4, ballNeck: 3.2, bowlHairline: 1.8 } },
    { id: "R4 · jewel ball", note: "the ball is the price point (accent)", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4, stem: 10, stemEnd: "ball", ballRadius: 3.4, bowlHairline: 1.8, ballRole: "jewel" } },
    { id: "R5 · monoline ball", note: "no stress: for comparison", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4, stem: 10, stemEnd: "ball", ballRadius: 3.4 } },
    { id: "R6 · open ball", note: "gap 13.5", params: { terminal: "serif", stroke: 5.5, gap: 13.5, stemWidth: 4, stem: 10, stemEnd: "ball", ballRadius: 3.4, bowlHairline: 1.8 } },
    { id: "R7 · letter (foot)", note: "the alternative: stress + foot", params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4.5, stem: 10, stemEnd: "serif", bowlHairline: 1.6 } },
    { id: "R8 · fine resonance", note: "stroke 5, gap 13, ball 3.2", params: { terminal: "serif", stroke: 5, gap: 13, stemWidth: 3.6, stem: 10, stemEnd: "ball", ballRadius: 3.2, bowlHairline: 1.6 } },
    { id: "S16a · favicon master", note: "no serifs, heavy, ball", params: { stroke: 7.5, gap: 10, stemWidth: 6, stem: 6, stemEnd: "ball", ballRadius: 5 } },
    { id: "S16b · favicon flat", note: "no serifs, heavy, flat stem", params: { stroke: 7.5, gap: 10, stemWidth: 6.5, stem: 9 } },
    { id: "S16c · favicon ball tight", note: "stroke 8, gap 9, ball 5.2", params: { stroke: 8, gap: 9, stemWidth: 6, stem: 5, stemEnd: "ball", ballRadius: 5.2 } },
  ],
};

