import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { ruleOf, settle } from "../../../lib/challenge.ts";
import { agentWriter, run } from "../../../lib/host.ts";
import { ruleInput } from "../../../lib/inputs.ts";
import { txUrl } from "../../../lib/venue.ts";

const inputs = {
  rule: ruleInput,
  once: {
    type: InputFieldType.Boolean,
    flag: "once",
    message: "Try once instead of waiting up to three minutes for the auction",
    required: false,
    prompt: false,
    default: false,
  },
} satisfies InputSchema;

type Result = Omit<Awaited<ReturnType<typeof settle>>, "transaction"> & { transaction: string };

export default class ChallengeSettle extends PluginCommand<Result> {
  static override description = "Records the challenge account's open order once its auction has run, so the fill counts toward the account's score.";
  static override examples = ["<%= config.bin %> unison challenge settle", "<%= config.bin %> unison challenge settle --rule old --once"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:challenge:settle";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const r = await settle(await agentWriter(this.ctx, io, this.pluginCommandId), ruleOf(i.rule), { waitMs: i.once ? 0 : 180_000 });
      return { ...r, transaction: txUrl(r.transaction) };
    });
  }

  override successHint(d: Result): string {
    return d.fill ? `Recorded fill #${d.fill.index}: ${d.fill.side} ${d.fill.base} for ${d.fill.quote}.` : "Settled: the order didn't fill, so nothing was recorded.";
  }
}
