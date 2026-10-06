import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { publicReader, run } from "../../lib/host.ts";
import { bps, limitInput, marketInput, quantityInput, sideInput, slippageInput } from "../../lib/inputs.ts";
import { readMarket } from "../../lib/markets.ts";
import { planOrder, sideName } from "../../lib/trading.ts";
import { bpsFrom, fromUnits } from "../../lib/units.ts";
import { UnisonError } from "../../lib/chain.ts";
import { marketByName } from "../../lib/venue.ts";

const inputs = { market: marketInput(0), side: sideInput(1), quantity: quantityInput(2), limit: limitInput, slippage: slippageInput } satisfies InputSchema;

type Result = {
  market: string;
  side: string;
  quantity: string;
  chainlinkReference: string | null;
  limit: string;
  limitVsReferenceBps: number | null;
  locks: string;
  fee: string;
  howItPrices: string;
};

export default class UnisonQuote extends PluginCommand<Result> {
  static override description =
    "What an order would lock and the most it can pay, before sending it. The price itself doesn't exist yet: the auction sets it at Chainlink's next observation, one price for everyone in it.";
  static override examples = ["<%= config.bin %> unison quote WMON buy 10", "<%= config.bin %> unison quote aNVDA sell 0.01 --limit 240.5"];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:quote";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const market = marketByName(i.market);
      if (!market) throw new UnisonError("UNISON_NO_MARKET", `no market "${i.market}"`, "`mm unison markets` lists them.");
      const s = await readMarket(publicReader().client, market);
      const side = i.side === "buy" ? 0 : 1;
      const p = planOrder(s, side, i.quantity, { limit: i.limit || undefined, slippageBps: bps(i.slippage) });
      const q = market.quote;
      const lockToken = side === 0 ? q : market.base;
      return {
        market: market.symbol,
        side: sideName(side),
        quantity: `${fromUnits(p.qty, market.base.decimals)} ${market.base.symbol}`,
        chainlinkReference: p.reference === null ? null : `${fromUnits(p.reference, q.decimals)} ${q.symbol}`,
        limit: `${fromUnits(p.limitPrice, q.decimals)} ${q.symbol}`,
        limitVsReferenceBps: p.reference === null ? null : bpsFrom(p.limitPrice, p.reference),
        locks: `${fromUnits(p.lock, lockToken.decimals)} ${lockToken.symbol}`,
        fee: `${s.feeBps / 100}% of the fill`,
        howItPrices: "Sealed when sent; priced at Chainlink's first observation after the seal; filled at one price for everyone in that auction, never past the limit.",
      };
    });
  }

  override successHint(d: Result): string {
    return `${d.side} ${d.quantity} at most ${d.limit} (Chainlink now ${d.chainlinkReference}); locks ${d.locks} until the auction runs`;
  }
}
