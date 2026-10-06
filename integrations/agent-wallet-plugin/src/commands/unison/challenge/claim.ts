import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { claimPot, ruleOf } from "../../../lib/challenge.ts";
import { agentWriter, run } from "../../../lib/host.ts";
import { ruleInput } from "../../../lib/inputs.ts";
import { txUrl } from "../../../lib/venue.ts";

const inputs = { rule: ruleInput } satisfies InputSchema;

type Result = { rule: string; account: string; edgeBps: number; counted: number; transaction: string };

export default class ChallengeClaim extends PluginCommand<Result> {
  static override description =
    "Claims the whole pot if the account's fills meet the definition. The contract checks every markout against Chainlink's history; nobody has to approve it.";
  static override examples = ["<%= config.bin %> unison challenge claim"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:challenge:claim";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const r = await claimPot(await agentWriter(this.ctx, io, this.pluginCommandId), ruleOf(i.rule));
      return { ...r, transaction: txUrl(r.transaction) };
    });
  }

  override successHint(d: Result): string {
    return `The ${d.rule} pot is yours: ${d.edgeBps} bp over ${d.counted} fills.`;
  }
}
