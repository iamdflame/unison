import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { UnisonError } from "../../lib/chain.ts";
import { agentWriter, run } from "../../lib/host.ts";
import { bps, limitInput, marketInput, quantityInput, sideInput, slippageInput } from "../../lib/inputs.ts";
import { readMarket } from "../../lib/markets.ts";
import { trade } from "../../lib/trade.ts";
import { marketByName } from "../../lib/venue.ts";

const inputs = {
  market: marketInput(0),
  side: sideInput(1),
  quantity: quantityInput(2),
  limit: limitInput,
  slippage: slippageInput,
  detach: {
    type: InputFieldType.Boolean,
    flag: "detach",
    message: "Return once the order is sealed, without waiting for its auction",
    required: false,
    prompt: false,
    default: false,
  },
} satisfies InputSchema;

type Result = Awaited<ReturnType<typeof trade>>;

export default class UnisonOrder extends PluginCommand<Result> {
  static override description =
    "Sends a sealed order to Unison's next auction and sees it through: priced at Chainlink's first observation after the seal, one price for everyone in the auction, settled, and its receipt checked from the chain.";
  static override examples = [
    "<%= config.bin %> unison order WMON buy 10",
    "<%= config.bin %> unison order WMON sell 10 --limit 0.0285",
    "<%= config.bin %> unison order aNVDA buy 0.01 --slippage 30 --json",
  ];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:order";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const market = marketByName(i.market);
      if (!market) throw new UnisonError("UNISON_NO_MARKET", `no market "${i.market}"`, "`mm unison markets` lists them.");
      const w = await agentWriter(this.ctx, io, this.pluginCommandId);
      const s = await readMarket(w.client, market);
      return trade(w, s, i.side === "buy" ? 0 : 1, i.quantity, {
        limit: i.limit || undefined,
        slippageBps: bps(i.slippage),
        detach: i.detach,
        say: (line) => io.emit(line),
      });
    });
  }

  override successHint(d: Result): string {
    if (d.status === "sealed") return `Sealed in block ${d.order.sealedInBlock}. \`mm unison balance\` shows it settle.`;
    const verdict = d.receipt ? `receipt ${d.receipt.passed}/${d.receipt.of} verified: ${d.receipt.receipt}` : "";
    return d.status === "filled"
      ? `${d.order.side === "buy" ? "Bought" : "Sold"} ${d.order.quantity} at ${d.auction?.price}, the auction's one price; ${verdict}`
      : `Not filled; funds returned. ${verdict}`;
  }
}
