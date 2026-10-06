import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { UnisonError } from "../../lib/chain.ts";
import { addressFor, publicReader, run } from "../../lib/host.ts";
import { addressInput } from "../../lib/inputs.ts";
import { balances } from "../../lib/trading.ts";

const inputs = { address: addressInput } satisfies InputSchema;

type Result = Awaited<ReturnType<typeof balances>>;

export default class UnisonBalance extends PluginCommand<Result> {
  static override description = "The agent wallet's tokens on Monad and on Unison, its MON for gas, and its open order slots.";
  static override examples = ["<%= config.bin %> unison balance", "<%= config.bin %> unison balance --address 0x… --json"];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:balance";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const account = addressFor(this.ctx, i.address || undefined);
      if (!account) throw new UnisonError("UNISON_NO_WALLET", "no address given and no EVM wallet selected", "Pass --address, or set up the agent wallet: `mm wallet select`.");
      return balances(publicReader().client, account);
    });
  }

  override successHint(d: Result): string {
    return [`${d.account}: ${d.mon} MON for gas`, ...d.tokens.map((t) => `  ${t.token}: ${t.wallet} in the wallet, ${t.onUnison} on Unison`)].join("\n");
  }
}
