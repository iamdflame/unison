import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { ruleOf, withdrawFromAccount } from "../../../lib/challenge.ts";
import { UnisonError } from "../../../lib/chain.ts";
import { agentWriter, run } from "../../../lib/host.ts";
import { amountInput, ruleInput, tokenInput } from "../../../lib/inputs.ts";
import { tokenByName, txUrl } from "../../../lib/venue.ts";

const inputs = { amount: amountInput(0, "How much to take out, or all"), token: tokenInput(1), rule: ruleInput } satisfies InputSchema;

type Result = { rule: string; account: string; token: string; amount: string; transaction: string };

export default class ChallengeWithdraw extends PluginCommand<Result> {
  static override description = "Takes tokens out of the challenge account back to the agent wallet (only between orders).";
  static override examples = ["<%= config.bin %> unison challenge withdraw all", "<%= config.bin %> unison challenge withdraw all WMON --rule old"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:challenge:withdraw";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const token = tokenByName(i.token || "AUSD");
      if (!token) throw new UnisonError("UNISON_NO_TOKEN", `no token "${i.token}" on Unison`, "Use AUSD or WMON.");
      const r = await withdrawFromAccount(await agentWriter(this.ctx, io, this.pluginCommandId), ruleOf(i.rule), token, i.amount);
      return { ...r, transaction: txUrl(r.transaction) };
    });
  }

  override successHint(d: Result): string {
    return `Withdrew ${d.amount} ${d.token} from the ${d.rule} challenge account.`;
  }
}
