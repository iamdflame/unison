/**
 * Raw logs → tape records, with the SDK ABIs. Each indexed contract is decoded with its own ABI (the vault's
 * `Deposited` is not the exchange's). Events the tape doesn't serve decode to undefined.
 */
import { decodeEventLog, hexToString, type Abi, type Hex } from "viem";
import { liquidityVaultAbi, operatorSignedReferenceAbi, orderGatewayAbi, unisonExchangeAbi } from "@unison/sdk";
import type { LogRef, TapeRecord } from "./db.ts";

/** A log as returned by eth_getLogs / eth_subscribe, normalised to numbers. */
export interface RawLog {
  address: string;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
  removed?: boolean;
  /** seconds, when the node includes it */
  blockTimestamp?: number;
}

export interface Sources {
  exchange: string;
  gateway?: string;
  operatorReference?: string;
  vaults: readonly string[];
}

type Kind = "exchange" | "gateway" | "vault" | "reference";

const ABI: Record<Kind, Abi> = {
  exchange: unisonExchangeAbi as Abi,
  gateway: orderGatewayAbi as Abi,
  vault: liquidityVaultAbi as Abi,
  reference: operatorSignedReferenceAbi as Abi,
};

export class LogDecoder {
  private readonly kinds = new Map<string, Kind>();

  constructor(s: Sources) {
    this.kinds.set(s.exchange.toLowerCase(), "exchange");
    if (s.gateway) this.kinds.set(s.gateway.toLowerCase(), "gateway");
    if (s.operatorReference) this.kinds.set(s.operatorReference.toLowerCase(), "reference");
    for (const v of s.vaults) this.kinds.set(v.toLowerCase(), "vault");
  }

  /** Addresses to filter eth_getLogs / eth_subscribe by. */
  get addresses(): Hex[] {
    return [...this.kinds.keys()] as Hex[];
  }

  /**
   * Decodes one log at time `tsMs`. Prints come back with empty derived fields (prevReceiptHash, chainOk, regime,
   * deviationBps, closeTs), which the indexer fills from the previous print.
   */
  decode(log: RawLog, tsMs: number): TapeRecord | undefined {
    const kind = this.kinds.get(log.address.toLowerCase());
    if (!kind || log.topics.length === 0) return undefined;
    let ev: { eventName: string; args: unknown };
    try {
      ev = decodeEventLog({ abi: ABI[kind], data: log.data, topics: log.topics as [Hex, ...Hex[]] }) as never;
    } catch {
      return undefined; // an event outside the ABI (or anonymous)
    }
    const ref: LogRef = { block: log.blockNumber, logIndex: log.logIndex, tx: log.transactionHash.toLowerCase(), ts: tsMs };
    const a = ev.args as Record<string, unknown>;
    const n = (k: string) => Number(a[k] as bigint);
    const s = (k: string) => (a[k] as bigint).toString();
    const addr = (k: string) => (a[k] as string).toLowerCase();
    const vault = log.address.toLowerCase();

    switch (`${kind}.${ev.eventName}`) {
      case "exchange.BatchCleared":
        return {
          table: "prints",
          row: {
            ...ref,
            marketId: n("marketId"),
            upTo: n("upToBlock"),
            tick: n("tick"),
            price: s("price"),
            volume: s("volume"),
            refPrice: s("refPrice"),
            refTimeMs: n("refTimeMs"),
            status: Number(a.status),
            bandLo: n("bandLo"),
            bandHi: n("bandHi"),
            receiptHash: (a.receiptHash as string).toLowerCase(),
            prevReceiptHash: "",
            chainOk: false,
            regime: "",
            deviationBps: null,
            closeTs: null,
          },
        };
      case "exchange.CausalReference":
        return {
          table: "causal_refs",
          row: {
            ...ref,
            marketId: n("marketId"),
            upTo: n("upToBlock"),
            round: s("round"),
            sealedAt: n("sealedAt"),
            observedAt: n("observedAt"),
          },
        };
      case "exchange.OrderPlaced":
        return {
          table: "orders_placed",
          row: {
            ...ref,
            marketId: n("marketId"),
            account: addr("account"),
            slot: n("slot"),
            side: n("side"),
            tick: n("tick"),
            qty: s("qty"),
            flags: n("flags"),
            batch: n("batch"),
          },
        };
      case "exchange.OrderCancelled":
        return {
          table: "orders_cancelled",
          row: { ...ref, marketId: n("marketId"), account: addr("account"), slot: n("slot"), releasedQty: s("releasedQty") },
        };
      case "exchange.Claimed":
        return {
          table: "claims",
          row: {
            ...ref,
            marketId: n("marketId"),
            account: addr("account"),
            slot: n("slot"),
            side: n("side"),
            baseAmount: s("baseAmount"),
            quoteAmount: s("quoteAmount"),
            fee: s("fee"),
            done: a.done as boolean,
          },
        };
      case "exchange.Deposited":
        return {
          table: "transfers",
          row: { ...ref, kind: "deposit", account: addr("account"), token: addr("token"), amount: s("amount"), counterparty: addr("payer") },
        };
      case "exchange.Withdrawn":
        return {
          table: "transfers",
          row: { ...ref, kind: "withdraw", account: addr("account"), token: addr("token"), amount: s("amount"), counterparty: addr("to") },
        };
      case "exchange.HaltSet":
        return regime(ref, n("marketId"), "halt", { halted: a.halted as boolean, by: addr("by") });
      case "exchange.RegimeSet": {
        const g = a.regime as Record<string, number | bigint | boolean>;
        return regime(ref, n("marketId"), "regime", {
          extBandBps: Number(g.extBandBps),
          reopenBandBps: Number(g.reopenBandBps),
          discFloorBps: Number(g.discFloorBps),
          discCapBps: Number(g.discCapBps),
          discHorizonSec: Number(g.discHorizonSec),
          discCadence: Number(g.discCadence),
          halted: Boolean(g.halted),
          closedSince: Number(g.closedSince),
          lastDiscoveryBatch: Number(g.lastDiscoveryBatch),
        });
      }
      case "exchange.DailyCapSet":
        return regime(ref, n("marketId"), "cap", { dailyCap: s("dailyCap"), by: addr("by") });
      case "exchange.TierSet":
        return regime(ref, n("marketId"), "tier", { tier: Number(a.tier) });
      case "exchange.NoticePosted":
        return regime(ref, n("marketId"), "notice", { docHash: (a.docHash as string).toLowerCase(), uri: a.uri as string });
      case "exchange.CurveFilled":
        return {
          table: "curve_fills",
          row: {
            ...ref,
            marketId: n("marketId"),
            source: addr("source"),
            upTo: n("upToBlock"),
            boughtBase: s("boughtBase"),
            paidQuote: s("paidQuote"),
            soldBase: s("soldBase"),
            receivedQuote: s("receivedQuote"),
          },
        };

      case "gateway.Relayed":
        return {
          table: "relayed",
          row: {
            ...ref,
            account: addr("account"),
            ok: true,
            authorizedBy: addr("authorizedBy"),
            kind: Number(a.kind),
            action: hexToString(a.action as Hex, { size: 32 }),
            ref: s("ref"),
            index: null,
            reason: null,
          },
        };
      case "gateway.RelayFailed":
        return {
          table: "relayed",
          row: {
            ...ref,
            account: addr("account"),
            ok: false,
            authorizedBy: null,
            kind: null,
            action: null,
            ref: null,
            index: n("index"),
            reason: (a.reason as string).toLowerCase(),
          },
        };
      case "gateway.SessionSet": {
        const g = a.grant as { expiry: bigint; maxQty: bigint; maxNotional: bigint; marketMask: bigint };
        return {
          table: "sessions",
          row: {
            ...ref,
            account: addr("account"),
            key: addr("key"),
            expiry: Number(g.expiry),
            maxQty: g.maxQty.toString(),
            maxNotional: g.maxNotional.toString(),
            marketMask: g.marketMask.toString(),
          },
        };
      }
      case "gateway.PasskeyRegistered":
        return {
          table: "passkeys",
          row: { ...ref, account: addr("account"), qx: (a.qx as string).toLowerCase(), qy: (a.qy as string).toLowerCase() },
        };

      case "vault.DepositRequested":
        return vaultEvent(ref, vault, "DepositRequested", n("id"), addr("owner"), { amount: s("assets") });
      case "vault.RedeemRequested":
        return vaultEvent(ref, vault, "RedeemRequested", n("id"), addr("owner"), { amount: s("shares") });
      case "vault.Deposited":
        return vaultEvent(ref, vault, "Deposited", n("id"), addr("owner"), {
          amount: s("assets"),
          shares: s("shares"),
          nav: s("nav"),
          swingFee: s("swingFee"),
        });
      case "vault.Redeemed":
        return vaultEvent(ref, vault, "Redeemed", n("id"), addr("owner"), {
          shares: s("shares"),
          baseOut: s("baseOut"),
          quoteOut: s("quoteOut"),
          swingFee: s("swingFee"), // a bps rate, not an amount
        });
      case "vault.Filled":
        return {
          table: "vault_fills",
          row: {
            ...ref,
            vault,
            batch: n("batch"),
            price: s("price"),
            refPrice: s("refPrice"),
            bought: s("bought"),
            sold: s("sold"),
            spreadPnl: s("spreadPnl"),
          },
        };

      case "reference.ReferenceAccepted":
        return {
          table: "references",
          row: {
            ...ref,
            marketId: n("marketId"),
            batch: n("batch"),
            price: s("price"),
            publishTimeMs: n("publishTimeMs"),
            status: Number(a.status),
            signers: n("signers"),
          },
        };
      default:
        return undefined;
    }
  }
}

function regime(
  ref: LogRef,
  marketId: number,
  kind: "halt" | "regime" | "cap" | "tier" | "notice",
  data: Record<string, unknown>,
): TapeRecord {
  return { table: "regime_events", row: { ...ref, marketId, kind, data: JSON.stringify(data) } };
}

function vaultEvent(
  ref: LogRef,
  vault: string,
  event: "DepositRequested" | "RedeemRequested" | "Deposited" | "Redeemed",
  requestId: number,
  owner: string,
  f: { amount?: string; shares?: string; nav?: string; baseOut?: string; quoteOut?: string; swingFee?: string },
): TapeRecord {
  return {
    table: "vault_events",
    row: {
      ...ref,
      vault,
      event,
      requestId,
      owner,
      amount: f.amount ?? null,
      shares: f.shares ?? null,
      nav: f.nav ?? null,
      baseOut: f.baseOut ?? null,
      quoteOut: f.quoteOut ?? null,
      swingFee: f.swingFee ?? null,
    },
  };
}
