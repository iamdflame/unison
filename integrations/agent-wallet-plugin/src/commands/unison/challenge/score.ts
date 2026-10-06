import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { ruleOf, score } from "../../../lib/challenge.ts";
import { UnisonError } from "../../../lib/chain.ts";
import { addressFor, publicReader, run } from "../../../lib/host.ts";
import { addressInput, ruleInput } from "../../../lib/inputs.ts";

const inputs = { rule: ruleInput, address: addressInput } satisfies InputSchema;

type Result = Awaited<ReturnType<typeof score>>;

export default class ChallengeScore extends PluginCommand<Result> {
  static override description =
    "A challenge account's standing, judged as a claim would be: every fill marked to the first Chainlink observation a minute after its order, by the contract itself.";
  static override examples = [
    "<%= config.bin %> unison challenge score",
    "<%= config.bin %> unison challenge score --rule old",
    "<%= config.bin %> unison challenge score --address 0xB1964fD4521977d71FE058A8b96140faddB611b6 --json",
  ];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:challenge:score";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const who = addressFor(this.ctx, i.address || undefined);
      if (!who) throw new UnisonError("UNISON_NO_WALLET", "no address given and no EVM wallet selected", "Pass --address (an owner or a challenge account), or `mm wallet select`.");
      return score(publicReader().client, ruleOf(i.rule), who);
    });
  }

  override successHint(d: Result): string {
    if (!("edgeBps" in d)) return `${d.note}. The ${d.rule} pot holds ${d.pot}.`;
    return `${d.counted} of ${d.minFills} counted fills, edge ${d.edgeBps} bp (${d.edge}); the pot pays above ${d.thresholdBps} bp. ${d.qualifies ? "It qualifies: `mm unison challenge claim`." : "Not yet."} Pot: ${d.pot}.`;
  }
}
