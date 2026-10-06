import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { challengeOrder, ruleOf, settle } from "../../../lib/challenge.ts";
import { agentWriter, run } from "../../../lib/host.ts";
import { bps, limitInput, quantityInput, ruleInput, sideInput, slippageInput } from "../../../lib/inputs.ts";
import { txUrl } from "../../../lib/venue.ts";

const inputs = {
  side: sideInput(0),
  quantity: quantityInput(1),
  limit: limitInput,
  slippage: slippageInput,
  rule: ruleInput,
  settle: {
    type: InputFieldType.Boolean,
    flag: "settle",
    message: "Wait for the auction, then record the fill (otherwise run `mm unison challenge settle`)",
    required: false,
    prompt: false,
    default: false,
  },
} satisfies InputSchema;

type Linked<T> = Omit<T, "transaction"> & { transaction: string };
type Result = Linked<Awaited<ReturnType<typeof challengeOrder>>> & { settled: Linked<Awaited<ReturnType<typeof settle>>> | null };

export default class ChallengeOrder extends PluginCommand<Result> {
  static override description =
    "Sends one sealed IOC order through the agent's challenge account. On the causal market it prices at Chainlink's first observation after the seal; on the control market, when the auction clears.";
  static override examples = [
    "<%= config.bin %> unison challenge order buy 10 --settle",
    "<%= config.bin %> unison challenge order sell 10 --rule old --slippage 20",
  ];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:challenge:order";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const w = await agentWriter(this.ctx, io, this.pluginCommandId);
      const rule = ruleOf(i.rule);
      const r = await challengeOrder(w, rule, i.side === "buy" ? 0 : 1, i.quantity, { limit: i.limit || undefined, slippageBps: bps(i.slippage) });
      if (!i.settle) return { ...r, transaction: txUrl(r.transaction), settled: null };
      io.emit("Sealed. Waiting for the auction to run, then recording the fill…");
      const s = await settle(w, rule, { waitMs: 180_000 });
      return { ...r, transaction: txUrl(r.transaction), settled: { ...s, transaction: txUrl(s.transaction) } };
    });
  }

  override successHint(d: Result): string {
    if (!d.settled) return `Sealed a ${d.side} of ${d.quantity} at ${d.limit}. Record it after its auction: mm unison challenge settle --rule ${d.rule}`;
    return d.settled.fill ? `Recorded fill #${d.settled.fill.index}: ${d.settled.fill.side} ${d.settled.fill.base} for ${d.settled.fill.quote}. \`mm unison challenge score\` shows the standing.` : "The order didn't fill; nothing was recorded.";
  }
}
