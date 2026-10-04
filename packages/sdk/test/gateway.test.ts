import { describe, expect, it } from "vitest";
import { createWalletClient, custom, decodeAbiParameters, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildCancel,
  buildOrder,
  buildSession,
  buildWithdraw,
  cancelFromJson,
  cancelToJson,
  encodeSig,
  gatewayDigest,
  gatewayDomain,
  gatewayTypes,
  sessionFromJson,
  sessionToJson,
  signAsAccount,
  signTypedForGateway,
  SIG_ACCOUNT,
  withdrawFromJson,
  withdrawToJson,
} from "../src/gateway.ts";

const alice = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const agent = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" as const;
const token = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const gateway = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853" as const;
const now = () => Math.floor(Date.now() / 1000);
const viaJson = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("action builders (buildOrder defaults: random nonce, 120 s deadline)", () => {
  it("cancel and withdraw", () => {
    const c = buildCancel({ account: alice.address, slot: 3 });
    expect(c.slot).toBe(3n);
    expect(c.nonce > 2n ** 128n).toBe(true); // 256-bit random (fails with probability 2^-128)
    expect(Number(c.deadline) - now()).toBeGreaterThanOrEqual(119);
    expect(Number(c.deadline) - now()).toBeLessThanOrEqual(120);
    expect(buildCancel({ account: alice.address, slot: 3n, nonce: 7n, ttlSeconds: 5 }).nonce).toBe(7n);
    const w = buildWithdraw({ account: alice.address, token, amount: 10n ** 6n, to: agent, ttlSeconds: 30 });
    expect([w.to, w.amount]).toEqual([agent, 10n ** 6n]);
    expect(Number(w.deadline) - now()).toBeLessThanOrEqual(30);
  });

  it("session grants: a mask from market ids, a 1 h default expiry, 0 revokes", () => {
    const s = buildSession({ account: alice.address, key: agent, maxQty: 2n * 10n ** 18n, maxNotional: 400n * 10n ** 6n, marketIds: [0, 2, 255] });
    expect(s.marketMask).toBe(1n | 4n | (1n << 255n));
    expect(Number(s.expiry) - now()).toBeGreaterThanOrEqual(3_599);
    expect(buildSession({ ...s, marketMask: 1n, expiry: 0n }).expiry).toBe(0n);
    expect(() => buildSession({ account: alice.address, key: agent, maxQty: 1n, maxNotional: 1n })).toThrow();
    expect(() => buildSession({ account: alice.address, key: agent, maxQty: 1n, maxNotional: 1n, marketIds: [256] })).toThrow();
  });
});

describe("JSON transport (relayer bodies { cancel | withdraw | session, sig })", () => {
  it("round-trips every bigint exactly", () => {
    const sig = "0xabcdef" as Hex;
    const c = buildCancel({ account: alice.address, slot: 54n });
    expect(cancelFromJson(viaJson(cancelToJson(c, sig)))).toEqual({ cancel: c, sig });
    const w = buildWithdraw({ account: alice.address, token, amount: 2n ** 200n + 1n, to: agent });
    expect(withdrawFromJson(viaJson(withdrawToJson(w, sig)))).toEqual({ withdraw: w, sig });
    const s = buildSession({ account: alice.address, key: agent, maxQty: 2n ** 96n - 1n, maxNotional: 2n ** 128n - 1n, marketMask: 2n ** 256n - 1n });
    expect(sessionFromJson(viaJson(sessionToJson(s, sig)))).toEqual({ session: s, sig });
    expect(Object.keys(viaJson(sessionToJson(s, sig)))).toEqual(["session", "sig"]);
  });
});

describe("signTypedForGateway (injected wallets)", () => {
  // a wallet client with a local account signs without touching the transport
  const wallet = createWalletClient({
    account: alice,
    transport: custom({
      request: async () => {
        throw new Error("no RPC expected");
      },
    }),
  });

  it("signs EIP-712 through the wallet client and wraps it as SIG_ACCOUNT", async () => {
    const o = buildOrder({ account: alice.address, marketId: 0n, side: 0, tick: 18_010n, qty: 10n ** 18n });
    const sig = await signTypedForGateway(wallet, 10_143, gateway, "Order", o);
    const [kind, data] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], sig);
    expect(kind).toBe(SIG_ACCOUNT);
    const signer = await recoverTypedDataAddress({
      domain: gatewayDomain(10_143, gateway),
      types: gatewayTypes,
      primaryType: "Order",
      message: o,
      signature: data,
    });
    expect(signer).toBe(alice.address);
    expect(sig).toBe(await signAsAccount(alice, 10_143, gateway, o));
    expect(sig).toBe(encodeSig(SIG_ACCOUNT, await alice.sign({ hash: gatewayDigest(10_143, gateway, "Order", { ...o }) })));
  });

  it("signs every action type", async () => {
    const actions = [
      ["Cancel", buildCancel({ account: alice.address, slot: 1 })],
      ["Withdraw", buildWithdraw({ account: alice.address, token, amount: 1n, to: agent })],
      ["Session", buildSession({ account: alice.address, key: agent, maxQty: 1n, maxNotional: 1n, marketIds: [0] })],
    ] as const;
    for (const [primaryType, message] of actions) {
      const sig = await signTypedForGateway(wallet, 143, gateway, primaryType, message);
      expect(sig).toBe(await signAsAccount(alice, 143, gateway, message, primaryType));
    }
  });

  it("needs an account", async () => {
    const bare = createWalletClient({ transport: custom({ request: async () => null }) });
    const o = buildOrder({ account: alice.address, marketId: 0n, side: 0, tick: 1n, qty: 1n });
    await expect(signTypedForGateway(bare, 143, gateway, "Order", o)).rejects.toThrow(/no account/);
  });
});
