/** In-memory RelayerChain: records what the relayer simulates, estimates and sends; receipts are scripted. */
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  pad,
  stringToHex,
  toHex,
  type Abi,
  type Hex,
} from "viem";
import { orderGatewayAbi, unisonExchangeAbi } from "@unison/sdk";
import type { ContractCall } from "../src/actions.ts";
import type { RelayerChain, TxReceipt } from "../src/chain.ts";

export const GATEWAY = "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853";
export const EXCHANGE = "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9";
export const RELAYER = "0x976ea74026e726554db657fa54763abd0c3a0aa9";

export interface Sent {
  hash: Hex;
  call: ContractCall;
  gas: bigint;
}

/** A revert the way viem reports it from simulateContract / estimateContractGas. */
export function revert(name: string, abi: Abi = [...unisonExchangeAbi, ...orderGatewayAbi] as Abi, args?: readonly unknown[]) {
  const data = encodeErrorResult({ abi, errorName: name, args } as never);
  return new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi, data, functionName: "place" }), {
    abi,
    args: [],
    functionName: "place",
  });
}

export const relayedLog = (ref: bigint, action = "place") => ({
  address: GATEWAY,
  topics: encodeEventTopics({
    abi: orderGatewayAbi,
    eventName: "Relayed",
    args: { account: pad("0x01", { size: 20 }), authorizedBy: pad("0x02", { size: 20 }) },
  }) as Hex[],
  data: encodeAbiParameters([{ type: "uint8" }, { type: "bytes32" }, { type: "uint256" }], [1, stringToHex(action, { size: 32 }), ref]),
});

export const relayFailedLog = (index: bigint, reason: Hex) => ({
  address: GATEWAY,
  topics: encodeEventTopics({ abi: orderGatewayAbi, eventName: "RelayFailed", args: { account: pad("0x01", { size: 20 }) } }) as Hex[],
  data: encodeAbiParameters([{ type: "uint256" }, { type: "bytes" }], [index, reason]),
});

export class FakeChain implements RelayerChain {
  readonly relayer = RELAYER;
  readonly chainId = 31_337;
  readonly simulated: ContractCall[] = [];
  readonly sent: Sent[] = [];
  /** throw from simulate / estimate to model reverts and outages */
  simulateError: ((call: ContractCall) => unknown) | undefined;
  estimateError: ((call: ContractCall) => unknown) | undefined;
  estimate: (call: ContractCall) => bigint = () => 100_000n;
  /** receipt of the n-th sent transaction */
  receipt: (s: Sent) => TxReceipt = () => ({ status: "success", logs: [] });
  read: <T>(call: ContractCall) => Promise<T> = async () => {
    throw new Error("unexpected read");
  };
  private readonly blockFns: ((n: bigint) => void)[] = [];

  async simulate(call: ContractCall) {
    this.simulated.push(call);
    const e = this.simulateError?.(call);
    if (e) throw e;
    return 0n;
  }

  async estimateGas(call: ContractCall) {
    const e = this.estimateError?.(call);
    if (e) throw e;
    return this.estimate(call);
  }

  async send(call: ContractCall, gas: bigint) {
    const hash = toHex(this.sent.length + 1, { size: 32 });
    this.sent.push({ hash, call, gas });
    return hash;
  }

  async waitForReceipt(hash: Hex) {
    const s = this.sent.find((x) => x.hash === hash);
    if (!s) throw new Error(`no such tx ${hash}`);
    return this.receipt(s);
  }

  watchBlocks(fn: (n: bigint) => void) {
    this.blockFns.push(fn);
    return () => void this.blockFns.splice(this.blockFns.indexOf(fn), 1);
  }
}

export const sentNames = (c: FakeChain) => c.sent.map((s) => s.call.functionName);
export { unisonExchangeAbi };
