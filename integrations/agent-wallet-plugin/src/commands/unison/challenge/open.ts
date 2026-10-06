import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { openAccount, ruleOf } from "../../../lib/challenge.ts";
import { agentWriter, run } from "../../../lib/host.ts";
import { ruleInput } from "../../../lib/inputs.ts";
import { txUrl } from "../../../lib/venue.ts";

const inputs = { rule: ruleInput } satisfies InputSchema;

type Result = { rule: string; account: string; opened: boolean; transaction: string | null };

export default class ChallengeOpen extends PluginCommand<Result> {
  static override description =
    "Opens the agent's account on the standing challenge: a pot for anyone whose fills beat Chainlink's next observation. Every fill through it is recorded, so a claim can't leave the losing ones out.";
  static override examples = ["<%= config.bin %> unison challenge open", "<%= config.bin %> unison challenge open --rule old"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:challenge:open";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const r = await openAccount(await agentWriter(this.ctx, io, this.pluginCommandId), ruleOf(i.rule));
      return { ...r, transaction: r.transaction ? txUrl(r.transaction) : null };
    });
  }

  override successHint(d: Result): string {
    return d.opened
      ? `Opened ${d.account} on the ${d.rule} challenge. Fund it: mm unison challenge fund 2 AUSD --rule ${d.rule}`
      : `This wallet already has ${d.account} on the ${d.rule} challenge.`;
  }
}
