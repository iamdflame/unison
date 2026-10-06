import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { fund, ruleOf } from "../../../lib/challenge.ts";
import { UnisonError } from "../../../lib/chain.ts";
import { agentWriter, run } from "../../../lib/host.ts";
import { amountInput, ruleInput, tokenInput } from "../../../lib/inputs.ts";
import { tokenByName } from "../../../lib/venue.ts";

const inputs = { amount: amountInput(0, "How much to put in the challenge account, e.g. 2"), token: tokenInput(1), rule: ruleInput } satisfies InputSchema;

type Result = Awaited<ReturnType<typeof fund>>;

export default class ChallengeFund extends PluginCommand<Result> {
  static override description = "Moves tokens from the agent wallet into its challenge account's Unison balance, approving the account for exactly that amount. WMON is wrapped from the wallet's MON if it falls short.";
  static override examples = ["<%= config.bin %> unison challenge fund 2", "<%= config.bin %> unison challenge fund 30 WMON --rule old"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:challenge:fund";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const token = tokenByName(i.token || "AUSD");
      if (!token) throw new UnisonError("UNISON_NO_TOKEN", `no token "${i.token}" on Unison`, "Use AUSD or WMON.");
      return fund(await agentWriter(this.ctx, io, this.pluginCommandId), ruleOf(i.rule), token, i.amount);
    });
  }

  override successHint(d: Result): string {
    return `The challenge account holds ${d.accountBalance} ${d.token} on Unison.`;
  }
}
