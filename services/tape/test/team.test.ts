import { describe, expect, it } from "vitest";
import { teamAccounts } from "../src/team.ts";

describe("the team's accounts", () => {
  it("counts the house adversary and its challenge accounts as the team's, however the record spells them", () => {
    const team = teamAccounts(
      {
        accounts: { deployer: "0x55DF8EA97d41b7F487c6Dcc077dFd0B487E3557D" },
        adversary: {
          address: "0xcEc80166Ab48cb3C4ebD98671524761b1fd81276",
          accounts: ["0xB1964fD4521977d71FE058A8b96140faddB611b6", "0xAc888Ed66Ba7599D89C59886E947A346D5a054f6"],
        },
      },
      " 0x55df8ea97d41b7f487c6dcc077dfd0b487e3557d, 0x13250c2de5ce381432f4f1c77249af6789d62da7,,",
    );
    expect(team).toEqual([
      "0x55df8ea97d41b7f487c6dcc077dfd0b487e3557d",
      "0xcec80166ab48cb3c4ebd98671524761b1fd81276",
      "0xb1964fd4521977d71fe058a8b96140faddb611b6",
      "0xac888ed66ba7599d89c59886e947a346d5a054f6",
      "0x13250c2de5ce381432f4f1c77249af6789d62da7",
    ]);
  });

  it("works without an adversary or an env list", () => {
    expect(teamAccounts({}, undefined)).toEqual([]);
  });
});
