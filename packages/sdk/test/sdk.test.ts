import { describe, expect, it } from "vitest";
import { decodeAbiParameters, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  encodeReport,
  formatUnitsExact,
  parseUnitsExact,
  referenceDigest,
  signReferenceEcdsa,
  Status,
  tickOfPrice,
  usEquitySession,
  nextSessionChange,
} from "../src/index.ts";

describe("US equity session calendar", () => {
  const at = (iso: string) => usEquitySession(new Date(iso));
  it("maps New York local time (with DST) to OPEN / EXTENDED / CLOSED", () => {
    expect(at("2026-10-05T14:00:00Z")).toBe(Status.OPEN); // Mon 10:00 EDT
    expect(at("2026-10-05T13:29:00Z")).toBe(Status.EXTENDED); // 09:29 pre-market
    expect(at("2026-10-05T13:30:00Z")).toBe(Status.OPEN); // the open
    expect(at("2026-10-05T20:00:00Z")).toBe(Status.EXTENDED); // 16:00 post-market
    expect(at("2026-10-06T00:00:00Z")).toBe(Status.CLOSED); // 20:00 EDT
    expect(at("2026-10-03T15:00:00Z")).toBe(Status.CLOSED); // Saturday
    expect(at("2026-12-07T15:00:00Z")).toBe(Status.OPEN); // Mon 10:00 EST (winter)
  });
  it("knows holidays and early closes", () => {
    expect(at("2026-11-26T15:00:00Z")).toBe(Status.CLOSED); // Thanksgiving
    expect(at("2026-11-27T17:30:00Z")).toBe(Status.OPEN); // 12:30 EST, early-close day
    expect(at("2026-11-27T18:30:00Z")).toBe(Status.EXTENDED); // 13:30 EST: after the 13:00 close
  });
  it("finds the next change (Friday close → weekend)", () => {
    const n = nextSessionChange(new Date("2026-10-09T23:00:00Z")); // Fri 19:00 EDT post-market
    expect(n.status).toBe(Status.CLOSED);
    expect(n.at.toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });
});

describe("prices", () => {
  it("parses and formats decimals exactly", () => {
    expect(parseUnitsExact("180.25", 6)).toBe(180_250_000n);
    expect(formatUnitsExact(180_250_000n, 6)).toBe("180.25");
    expect(formatUnitsExact(180_000_000n, 6, 2)).toBe("180.00");
    expect(() => parseUnitsExact("1.0000001", 6)).toThrow();
  });
  it("rounds ticks", () => {
    expect(tickOfPrice(180_005_000n, 10_000n)).toBe(18_001n);
    expect(tickOfPrice(180_009_999n, 10_000n, "down")).toBe(18_000n);
    expect(tickOfPrice(180_000_001n, 10_000n, "up")).toBe(18_001n);
  });
});

describe("operator-signed reports", () => {
  it("encodes a report the contract can decode, signed over the EIP-712 digest", async () => {
    const relay = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const adapter = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" as const;
    const msg = {
      venue: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as const,
      marketId: 0n,
      batch: 42n,
      price: 180_000_000n,
      publishTimeMs: 1_760_000_000_000n,
      status: Status.OPEN,
    };
    const sig = await signReferenceEcdsa(relay, 0, 31_337, adapter, msg);
    const payload = encodeReport({ price: msg.price, publishTimeMs: msg.publishTimeMs, status: msg.status, sigs: [sig] });
    const [decoded] = decodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "price", type: "uint256" },
            { name: "publishTimeMs", type: "uint64" },
            { name: "status", type: "uint8" },
            {
              name: "sigs",
              type: "tuple[]",
              components: [
                { name: "signerId", type: "uint8" },
                { name: "v", type: "uint8" },
                { name: "r", type: "bytes32" },
                { name: "s", type: "bytes32" },
              ],
            },
          ],
        },
      ],
      payload as Hex,
    );
    expect(decoded.price).toBe(180_000_000n);
    expect(decoded.sigs[0]!.v === 27 || decoded.sigs[0]!.v === 28).toBe(true);
    expect(referenceDigest(31_337, adapter, msg)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
