import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { UnisonError } from "../../lib/chain.ts";
import { agentWriter, run } from "../../lib/host.ts";
import { amountInput, tokenInput } from "../../lib/inputs.ts";
import { withdraw } from "../../lib/trading.ts";
import { tokenByName, txUrl } from "../../lib/venue.ts";

const inputs = { amount: amountInput(0, "How much to withdraw, or all"), token: tokenInput(1) } satisfies InputSchema;

type Result = { token: string; amount: string; transaction: string };

export default class UnisonWithdraw extends PluginCommand<Result> {
  static override description = "Withdraws from the agent's Unison balance back to its wallet.";
  static override examples = ["<%= config.bin %> unison withdraw all", "<%= config.bin %> unison withdraw 10 WMON"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:withdraw";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const token = tokenByName(i.token || "AUSD");
      if (!token) throw new UnisonError("UNISON_NO_TOKEN", `no token "${i.token}" on Unison`, "Use AUSD, WMON or aNVDA.");
      const r = await withdraw(await agentWriter(this.ctx, io, this.pluginCommandId), token, i.amount);
      return { ...r, transaction: txUrl(r.transaction) };
    });
  }

  override successHint(d: Result): string {
    return `Withdrew ${d.amount} ${d.token} to the wallet.`;
  }
}
