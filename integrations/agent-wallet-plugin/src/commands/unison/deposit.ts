import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { UnisonError } from "../../lib/chain.ts";
import { agentWriter, run } from "../../lib/host.ts";
import { amountInput, tokenInput } from "../../lib/inputs.ts";
import { deposit } from "../../lib/trading.ts";
import { tokenByName } from "../../lib/venue.ts";

const inputs = { amount: amountInput(0, "How much to deposit, e.g. 2"), token: tokenInput(1) } satisfies InputSchema;

type Result = Awaited<ReturnType<typeof deposit>>;

export default class UnisonDeposit extends PluginCommand<Result> {
  static override description =
    "Deposits tokens from the agent wallet to its Unison balance, which orders trade from. Approves the exchange for exactly that amount, never more.";
  static override examples = ["<%= config.bin %> unison deposit 2", "<%= config.bin %> unison deposit 10 WMON"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:deposit";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const token = tokenByName(i.token || "AUSD");
      if (!token) throw new UnisonError("UNISON_NO_TOKEN", `no token "${i.token}" on Unison`, "Use AUSD, WMON or aNVDA.");
      return deposit(await agentWriter(this.ctx, io, this.pluginCommandId), token, i.amount);
    });
  }

  override successHint(d: Result): string {
    return `Deposited ${d.amount} ${d.token}; ${d.onUnison} ${d.token} on Unison now.`;
  }
}
