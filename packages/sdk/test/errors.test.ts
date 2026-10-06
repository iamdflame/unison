import { describe, expect, it } from "vitest";
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  type Abi,
} from "viem";
import { chainlinkCausalReferenceAbi, liquidityVaultAbi, orderGatewayAbi, unisonExchangeAbi } from "../src/abis/index.ts";
import { decodeUnisonError, UNISON_ERROR_MESSAGES, UNKNOWN_ERROR_MESSAGE, unisonErrorsAbi } from "../src/errors.ts";

const merged = [...unisonExchangeAbi, ...orderGatewayAbi, ...liquidityVaultAbi, ...chainlinkCausalReferenceAbi] as Abi;
/** Revert data for `errorName`; arguments default to zero values (e.g. ObservationExists(uint80 round)). */
const data = (errorName: string, args?: readonly unknown[]) => {
  const e = merged.find((x) => x.type === "error" && x.name === errorName) as { inputs: { type: string }[] } | undefined;
  const zero = (t: string) => (/^u?int/.test(t) ? 0n : t === "bool" ? false : t === "address" ? "0x0000000000000000000000000000000000000000" : "0x");
  return encodeErrorResult({ abi: merged, errorName, args: args ?? e?.inputs.map((i) => zero(i.type)) } as never);
};

describe("decodeUnisonError", () => {
  it("covers every code in the table from raw revert data (e.g. a RelayFailed reason)", () => {
    for (const [code, message] of Object.entries(UNISON_ERROR_MESSAGES)) {
      expect(decodeUnisonError(data(code))).toEqual({ code, message });
    }
  });

  it("says the exact words the product uses", () => {
    expect(decodeUnisonError(data("NoFreeOrderSlot")).message).toBe("You have 55 open orders. Claim or cancel some first.");
    expect(decodeUnisonError(data("TooEarly")).message).toBe("Overnight call auction: the next auction is a few blocks away.");
    expect(decodeUnisonError(data("ClearRunning")).message).toBe("The vault is waiting for the current auction; retry in a moment.");
  });

  it("reads viem simulate / write errors, decoded or not", () => {
    const decoded = new ContractFunctionExecutionError(
      new ContractFunctionRevertedError({ abi: merged, data: data("SessionExpired"), functionName: "place" }),
      { abi: merged, args: [], functionName: "place" },
    );
    expect(decodeUnisonError(decoded)).toEqual({ code: "SessionExpired", message: "This session key has expired or was revoked." });
    // the call's ABI didn't know the error (e.g. bubbled from the exchange through the gateway): selector lookup
    const raw = new ContractFunctionRevertedError({ abi: [], data: data("NotEligible"), functionName: "place" });
    expect(decodeUnisonError(raw).code).toBe("NotEligible");
    const wrapped = new BaseError("execution reverted", { cause: Object.assign(new Error("rpc"), { data: data("PendingFull") }) });
    expect(decodeUnisonError(wrapped).code).toBe("PendingFull");
  });

  it("reads JSON-RPC error objects, bare names and messages", () => {
    expect(decodeUnisonError({ code: 3, message: "execution reverted", data: data("Expired") }).code).toBe("Expired");
    expect(decodeUnisonError({ jsonrpc: "2.0", id: 1, error: { code: 3, data: data("BadSignature") } }).code).toBe("BadSignature");
    expect(decodeUnisonError({ data: { data: data("BadSignature") } }).code).toBe("BadSignature");
    expect(decodeUnisonError("ClearInProgress")).toEqual({ code: "ClearInProgress", message: UNISON_ERROR_MESSAGES.ClearInProgress });
    expect(decodeUnisonError(new Error('The contract function "place" reverted.\n\nError: TooManyGroups()')).code).toBe("TooManyGroups");
  });

  it("names errors outside the table but keeps the generic message", () => {
    const erc20 = data("ERC20InsufficientBalance", ["0x0000000000000000000000000000000000000001", 1n, 2n]);
    expect(decodeUnisonError(erc20)).toEqual({ code: "ERC20InsufficientBalance", message: UNKNOWN_ERROR_MESSAGE });
    expect(decodeUnisonError(encodeErrorResult({ abi: [{ type: "error", name: "Error", inputs: [{ type: "string" }] }], errorName: "Error", args: ["nope"] })).code).toBe("Error");
  });

  it("falls back to UNKNOWN", () => {
    for (const e of [undefined, null, "0x", "0x12345678", new Error("socket hang up"), 42, { foo: 1 }]) {
      expect(decodeUnisonError(e)).toEqual({ code: "UNKNOWN", message: "Something went wrong on-chain." });
    }
  });

  it("merges the three ABIs without duplicate signatures", () => {
    const sigs = unisonErrorsAbi.map((e) => `${e.name}(${e.inputs.map((i) => i.type).join(",")})`);
    expect(new Set(sigs).size).toBe(sigs.length);
    expect(sigs).toContain("ClearRunning()");
    expect(sigs).toContain("UnknownPasskey()");
    expect(sigs).toContain("InsufficientBalance()");
  });
});
