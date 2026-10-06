import { type ChildProcess, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, type PublicClient, parseEther } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { challengeAccountAbi, unisonExchangeAbi } from "@unison/sdk/abis/index.ts";
import { accountOf, challengeOrder, fund, openAccount } from "../src/lib/challenge.ts";
import { UnisonError, type Writer } from "../src/lib/chain.ts";
import { readMarket } from "../src/lib/markets.ts";
import { checkCovered, deposit, placeOrder, planOrder, venueBalance, withdraw } from "../src/lib/trading.ts";
import { exchange, marketByName, RPC_URL, tokenByName } from "../src/lib/venue.ts";

/**
 * The plugin's write paths against Monad mainnet's own contracts, on an anvil fork: the same Writer interface the
 * MetaMask executor fills in production, here filled by an unlocked anvil account. Opt in with FORK=1 (it needs anvil
 * and Monad's RPC). What a fork can't do is run the auction: that needs a Chainlink observation after the seal.
 */
const runs = process.env.FORK === "1";
const PORT = 8547;
const LOCAL = `http://127.0.0.1:${PORT}`;
const AGENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const; // anvil's second account: not the team's
const AUSD = tokenByName("AUSD")!;
const WMON = tokenByName("WMON")!;

let anvil: ChildProcess;
let client: PublicClient;
let w: Writer;

async function waitForRpc() {
  for (let i = 0; i < 120; i++) {
    try {
      await createPublicClient({ transport: http(LOCAL) }).getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("anvil didn't start");
}

describe.skipIf(!runs)("the write paths, on an anvil fork of Monad mainnet", () => {
  beforeAll(async () => {
    const bin = process.env.ANVIL ?? join(homedir(), ".foundry", "bin", process.platform === "win32" ? "anvil.exe" : "anvil");
    anvil = spawn(bin, ["--fork-url", process.env.FORK_URL ?? RPC_URL, "--port", String(PORT), "--chain-id", "143", "--silent"], { stdio: "ignore" });
    await waitForRpc();
    client = createPublicClient({ transport: http(LOCAL) }) as PublicClient;
    const wallet = createWalletClient({ transport: http(LOCAL) });
    // fund the agent from the exchange's custody, on the fork only
    await client.request({ method: "anvil_impersonateAccount" as never, params: [exchange] as never });
    await client.request({ method: "anvil_setBalance" as never, params: [exchange, "0x3635C9ADC5DEA00000"] as never });
    for (const [token, amount] of [[AUSD, 5_000_000n], [WMON, parseEther("20")]] as const) {
      const hash = await wallet.sendTransaction({ account: exchange, chain: null, to: token.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [AGENT, amount] }) });
      await client.waitForTransactionReceipt({ hash });
    }
    w = {
      client,
      account: AGENT,
      async send(call) {
        const hash = await wallet.sendTransaction({ account: AGENT, chain: null, to: call.to, data: call.data, value: call.value });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`${call.summary} reverted`);
        return { hash, receipt };
      },
    };
  }, 120_000);

  afterAll(() => {
    anvil?.kill();
  });

  it("deposits: approves exactly the amount, then credits it on Unison", async () => {
    const r = await deposit(w, AUSD, "2");
    expect(r.transactions).toHaveLength(2);
    expect(await venueBalance(client, AGENT, AUSD)).toBe(2_000_000n);
    expect(await client.readContract({ address: AUSD.address, abi: erc20Abi, functionName: "allowance", args: [AGENT, exchange] })).toBe(0n);
  });

  it("seals a buy on WMON/AUSD in this block's batch, locking exactly the plan's amount", async () => {
    const s = await readMarket(client, marketByName("WMON")!);
    const plan = planOrder(s, 0, "10", {});
    await checkCovered(client, AGENT, plan);
    const before = await venueBalance(client, AGENT, AUSD);
    const placed = await placeOrder(w, plan);
    expect(placed.batch).toBe(placed.block);
    expect(before - (await venueBalance(client, AGENT, AUSD))).toBe(plan.lock);
    const bitmap = await client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "openOrderBitmap", args: [AGENT] });
    expect((bitmap >> placed.slot) & 1n).toBe(1n);
    const o = await client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "orderOf", args: [AGENT, placed.slot] });
    expect(o.tick).toBe(plan.limitTick);
    expect(o.qty).toBe(plan.qty);
  });

  it("refuses an order the balance can't cover, before anything is signed", async () => {
    const s = await readMarket(client, marketByName("WMON")!);
    const e = await checkCovered(client, AGENT, planOrder(s, 0, "1000", {})).catch((x: UnisonError) => x);
    expect(e).toBeInstanceOf(UnisonError);
    expect((e as UnisonError).code).toBe("UNISON_NOT_COVERED");
    expect((e as UnisonError).hint).toMatch(/^Deposit at least [\d.]+ AUSD first: mm unison deposit [\d.]+ AUSD$/);
  });

  it("opens a challenge account, funds it and sends an order through it", async () => {
    const opened = await openAccount(w, "causal");
    expect(opened.opened).toBe(true);
    expect(await accountOf(client, "causal", AGENT)).toBe(opened.account);
    const again = await openAccount(w, "causal");
    expect(again.opened).toBe(false);
    const f = await fund(w, "causal", AUSD, "1");
    expect(f.accountBalance).toBe("1");
    const o = await challengeOrder(w, "causal", 0, "10", {});
    expect(o.placedAt).toBeGreaterThan(0);
    expect(await client.readContract({ address: opened.account, abi: challengeAccountAbi, functionName: "orderOpen" })).toBe(true);
  });

  it("withdraws what isn't locked", async () => {
    const left = await venueBalance(client, AGENT, AUSD);
    const r = await withdraw(w, AUSD, "all");
    expect(r.amount).not.toBe("0");
    expect(await venueBalance(client, AGENT, AUSD)).toBe(0n);
    expect(left).toBeGreaterThan(0n);
  });
});
