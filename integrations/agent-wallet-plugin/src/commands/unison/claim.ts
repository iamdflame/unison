import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { agentWriter, run } from "../../lib/host.ts";
import { claimSettled } from "../../lib/trading.ts";
import { txUrl } from "../../lib/venue.ts";

const inputs = {} satisfies InputSchema;

type Result = { claimed: string[]; transaction: string | null };

export default class UnisonClaim extends PluginCommand<Result> {
  static override description =
    "Claims every settled order of the agent's that the keeper hasn't claimed yet, crediting its fills and refunds to its Unison balance.";
  static override examples = ["<%= config.bin %> unison claim"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:claim";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const r = await claimSettled(await agentWriter(this.ctx, io, this.pluginCommandId));
      return { claimed: r.claimed, transaction: r.transaction ? txUrl(r.transaction) : null };
    });
  }

  override successHint(d: Result): string {
    return d.claimed.length ? `Claimed slot${d.claimed.length === 1 ? "" : "s"} ${d.claimed.join(", ")}.` : "Nothing to claim: the keeper had settled everything.";
  }
}
