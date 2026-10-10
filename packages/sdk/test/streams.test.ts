import { createHash, createHmac } from "node:crypto";
import { decodeAbiParameters, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { encodeStreamsPayload, firstReportAfter, streamsApi, type StreamsApi, type StreamsReport } from "../src/streams.ts";

const FEED: Hex = "0x000b6aa036224454037bab103184565f6aa9ea589c3b349f6d8471ee753524b9"; // NVDA/USD, regular hours

const report = (validFrom: number, obs: number): StreamsReport => ({
  feedID: FEED,
  validFromTimestamp: validFrom,
  observationsTimestamp: obs,
  fullReport: `0x${obs.toString(16).padStart(8, "0")}`,
});

describe("Data Streams API client", () => {
  it("signs each request as Chainlink documents: HMAC-SHA256 over method, path, body hash, key and time", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetch = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url, headers: init?.headers ?? {} });
      return new Response(JSON.stringify({ report: report(1_000, 1_000) }), { status: 200 });
    });
    const api = streamsApi({ key: "key-uuid", secret: "s3cret", fetch: fetch as unknown as typeof globalThis.fetch });
    const r = await api.reportAt(FEED, 1_000n);
    expect(r?.observationsTimestamp).toBe(1_000);

    const { url, headers } = seen[0]!;
    const path = `/api/v1/reports?feedID=${FEED}&timestamp=1000`;
    expect(url).toBe(`https://api.dataengine.chain.link${path}`);
    expect(headers.Authorization).toBe("key-uuid");
    const ts = headers["X-Authorization-Timestamp"]!;
    const bodyHash = createHash("sha256").update("").digest("hex");
    const want = createHmac("sha256", "s3cret").update(`GET ${path} ${bodyHash} key-uuid ${ts}`).digest("hex");
    expect(headers["X-Authorization-Signature-SHA256"]).toBe(want);
  });

  it("reads 404 as no report, and any other failure as an error", async () => {
    const notFound = streamsApi({ key: "k", secret: "s", fetch: (async () => new Response("", { status: 404 })) as unknown as typeof fetch });
    expect(await notFound.reportAt(FEED, 1n)).toBeNull();
    const down = streamsApi({ key: "k", secret: "s", fetch: (async () => new Response("", { status: 503 })) as unknown as typeof fetch });
    await expect(down.latest(FEED)).rejects.toThrow("HTTP 503");
  });
});

describe("the first report after a seal", () => {
  const api = (exact: StreamsReport | null, page: StreamsReport[] = []): StreamsApi => ({
    reportAt: vi.fn(async () => exact),
    page: vi.fn(async () => page),
    latest: vi.fn(async () => null),
  });

  it("is the report whose window holds the second after it", async () => {
    expect(await firstReportAfter(api(report(1_003, 1_003)), FEED, 1_002n)).toEqual(report(1_003, 1_003));
  });

  it("after a gap, is the next report, whose window absorbed the missing seconds", async () => {
    const a = api(null, [report(1_001, 1_005)]);
    expect(await firstReportAfter(a, FEED, 1_002n)).toEqual(report(1_001, 1_005));
    expect(a.page).toHaveBeenCalledWith(FEED, 1_003n, 1);
  });

  it("is nothing until it exists, and never a report whose window misses the second", async () => {
    expect(await firstReportAfter(api(null, []), FEED, 1_002n)).toBeNull();
    expect(await firstReportAfter(api(null, [report(1_004, 1_004)]), FEED, 1_002n)).toBeNull(); // an earlier one is missing
  });
});

describe("the clear payload", () => {
  it("names the report by its observation time, and the quote round in force", () => {
    const [obs, round] = decodeAbiParameters([{ type: "uint32" }, { type: "uint80" }], encodeStreamsPayload(1_788_360_082n, 18_446_744_073_709_556_856n));
    expect(obs).toBe(1_788_360_082);
    expect(round).toBe(18_446_744_073_709_556_856n);
  });
});
