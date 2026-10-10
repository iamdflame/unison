/**
 * The causal clock on Chainlink Data Streams (docs/evidence/streams.md, contracts/src/pricing/StreamsCausalReference.sol).
 * A Data Streams report covers a window of oracle time, [validFromTimestamp, observationsTimestamp], and Chainlink builds
 * the windows contiguous, so the report whose window holds `afterSec + 1` is the first observation after `afterSec`.
 * This module fetches that report from the Data Streams API and builds the clear payload the adapter reads:
 * abi.encode(uint32 observationsTimestamp, uint80 quoteRound).
 *
 *   const api = streamsApi({ key, secret }); // credentials from Chainlink; server side only
 *   const p = await streamsPayload(publicClient, api, adapter, marketId, oldestOrderTime + skew);
 *   if (p && !p.stored) await client.submitStreamsReport(adapter, p.report.fullReport);
 *   if (p) await client.clear(marketId, p.payload);
 */
import { encodeAbiParameters, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { roundInForce } from "./causal.ts";

export const streamsCausalReferenceAbi = parseAbi([
  "function streams(uint256) view returns (bytes32 feedId, address quote, uint8 quoteFeedDecimals, uint8 quoteTokenDecimals, uint8 liveSessions, uint32 quoteMaxAgeSec, uint32 maxMidAgeSec, uint32 maxLatestAgeSec, uint16 depegBps, bool set)",
  "function report(bytes32 feedId, uint32 observedAt) view returns ((uint128 price, uint32 validFrom, uint32 midAt, uint8 session, bool set))",
  "function newestObservation(bytes32 feedId) view returns (uint32)",
  "function verifier() view returns (address)",
  "function submit(bytes signed) returns (bytes32 feedId, uint32 observedAt)",
  "event ReportStored(bytes32 indexed feedId, uint32 indexed observedAt, uint32 validFrom, uint256 price, uint8 session, address by)",
]);

const ZERO: Address = "0x0000000000000000000000000000000000000000";

/** A report as the Data Streams API serves it. */
export interface StreamsReport {
  feedID: Hex;
  validFromTimestamp: number;
  observationsTimestamp: number;
  /** the signed report, as `StreamsCausalReference.submit` takes it */
  fullReport: Hex;
}

export interface StreamsApi {
  /** the report observed at exactly `ts`, or null when there is none */
  reportAt(feedId: Hex, ts: bigint): Promise<StreamsReport | null>;
  /** up to `limit` reports observed at or after `startTs`, oldest first */
  page(feedId: Hex, startTs: bigint, limit: number): Promise<StreamsReport[]>;
  /** the newest report */
  latest(feedId: Hex): Promise<StreamsReport | null>;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * A Data Streams API client. Requests are signed as Chainlink documents: HMAC-SHA256, keyed by the API secret, over
 * `METHOD path?query sha256(body) apiKey timestampMs`. WebCrypto only, so the SDK stays free of Node built-ins; the
 * credentials belong on a server (the keeper), never in a browser.
 */
export function streamsApi(cfg: {
  key: string;
  secret: string;
  /** default: mainnet, https://api.dataengine.chain.link (testnet: https://api.testnet-dataengine.chain.link) */
  url?: string;
  fetch?: typeof fetch;
}): StreamsApi {
  const base = (cfg.url ?? "https://api.dataengine.chain.link").replace(/\/$/, "");
  const doFetch = cfg.fetch ?? fetch;
  const enc = new TextEncoder();
  const subtle = globalThis.crypto.subtle;
  const keyP = subtle.importKey("raw", enc.encode(cfg.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const emptyHash = subtle.digest("SHA-256", new Uint8Array(0)).then(hex);

  async function get(path: string): Promise<Record<string, unknown> | null> {
    const ts = Date.now().toString();
    const signed = `GET ${path} ${await emptyHash} ${cfg.key} ${ts}`;
    const signature = hex(await subtle.sign("HMAC", await keyP, enc.encode(signed)));
    const res = await doFetch(base + path, {
      headers: {
        Authorization: cfg.key,
        "X-Authorization-Timestamp": ts,
        "X-Authorization-Signature-SHA256": signature,
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Data Streams ${path.split("?")[0]}: HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }
  const norm = (r: unknown): StreamsReport | null => {
    const x = r as Partial<StreamsReport> | null | undefined;
    if (!x?.fullReport) return null;
    return {
      feedID: x.feedID as Hex,
      validFromTimestamp: Number(x.validFromTimestamp),
      observationsTimestamp: Number(x.observationsTimestamp),
      fullReport: x.fullReport as Hex,
    };
  };
  return {
    async reportAt(feedId, ts) {
      return norm((await get(`/api/v1/reports?feedID=${feedId}&timestamp=${ts}`))?.report);
    },
    async page(feedId, startTs, limit) {
      const j = await get(`/api/v1/reports/page?feedID=${feedId}&startTimestamp=${startTs}&limit=${limit}`);
      const list = (j?.reports ?? j?.report ?? []) as unknown[];
      return (Array.isArray(list) ? list : [list]).map(norm).filter((r): r is StreamsReport => r !== null);
    },
    async latest(feedId) {
      return norm((await get(`/api/v1/reports/latest?feedID=${feedId}`))?.report);
    },
  };
}

/**
 * The report whose window holds `afterSec + 1`: the first observation after `afterSec`, which is the only report the
 * adapter will accept for it. Null when it isn't out yet.
 */
export async function firstReportAfter(api: StreamsApi, feedId: Hex, afterSec: bigint): Promise<StreamsReport | null> {
  const t = afterSec + 1n;
  const r = (await api.reportAt(feedId, t)) ?? (await api.page(feedId, t, 1))[0] ?? null;
  if (!r) return null;
  if (BigInt(r.validFromTimestamp) > t || BigInt(r.observationsTimestamp) < t) return null;
  return r;
}

export function encodeStreamsPayload(observedAt: bigint, quoteRound: bigint): Hex {
  return encodeAbiParameters([{ type: "uint32" }, { type: "uint80" }], [Number(observedAt), quoteRound]);
}

/** Whether `adapter` is a StreamsCausalReference (it names Chainlink's verifier); a Chainlink push adapter is not. */
export async function isStreamsAdapter(client: PublicClient, adapter: Address): Promise<boolean> {
  try {
    const v: unknown = await client.readContract({ address: adapter, abi: streamsCausalReferenceAbi, functionName: "verifier" });
    return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) && BigInt(v) !== 0n;
  } catch {
    return false;
  }
}

/**
 * The clear payload for the auction whose orders were sealed by `afterSec` (the oldest waiting order's time plus the
 * market's skew): the first report after it, the quote round in force at that report's observation, and whether the
 * report is already on chain. Null when the report isn't out yet.
 */
export async function streamsPayload(
  client: PublicClient,
  api: StreamsApi,
  adapter: Address,
  marketId: bigint,
  afterSec: bigint,
): Promise<{ payload: Hex; report: StreamsReport; observedAt: bigint; stored: boolean; quoteRound: bigint } | null> {
  const [feedId, quote, , , , , , , , set] = await client.readContract({
    address: adapter,
    abi: streamsCausalReferenceAbi,
    functionName: "streams",
    args: [marketId],
  });
  if (!set) throw new Error(`market ${marketId} has no stream on ${adapter}`);
  const report = await firstReportAfter(api, feedId, afterSec);
  if (!report) return null;
  const observedAt = BigInt(report.observationsTimestamp);
  const [onChain, quoteRound] = await Promise.all([
    client.readContract({
      address: adapter,
      abi: streamsCausalReferenceAbi,
      functionName: "report",
      args: [feedId, Number(observedAt)],
    }),
    quote === ZERO ? Promise.resolve(0n) : roundInForce(client, quote, observedAt).then((o) => o.round),
  ]);
  return { payload: encodeStreamsPayload(observedAt, quoteRound), report, observedAt, stored: onChain.set, quoteRound };
}

/**
 * The newest report, for an auction with no orders waiting (a vault's queue): the adapter's `latest` serves only a
 * report observed within `maxLatestAgeSec`, so it must be brought on chain first unless it already is.
 */
export async function latestStreamsReport(
  client: PublicClient,
  api: StreamsApi,
  adapter: Address,
  marketId: bigint,
): Promise<{ report: StreamsReport; observedAt: bigint; stored: boolean } | null> {
  const [feedId, , , , , , , , , set] = await client.readContract({
    address: adapter,
    abi: streamsCausalReferenceAbi,
    functionName: "streams",
    args: [marketId],
  });
  if (!set) throw new Error(`market ${marketId} has no stream on ${adapter}`);
  const report = await api.latest(feedId);
  if (!report) return null;
  const observedAt = BigInt(report.observationsTimestamp);
  const onChain = await client.readContract({
    address: adapter,
    abi: streamsCausalReferenceAbi,
    functionName: "report",
    args: [feedId, Number(observedAt)],
  });
  return { report, observedAt, stored: onChain.set };
}
