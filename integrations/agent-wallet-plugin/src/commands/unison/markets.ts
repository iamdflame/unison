import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { publicReader, run } from "../../lib/host.ts";
import { describeMarket, readMarkets } from "../../lib/markets.ts";

const inputs = {} satisfies InputSchema;

type Result = { markets: ReturnType<typeof describeMarket>[] };

export default class UnisonMarkets extends PluginCommand<Result> {
  static override description =
    "Unison's markets on Monad, live from the chain: each market's state, Chainlink's newest observation and the last auction's price.";
  static override examples = ["<%= config.bin %> unison markets", "<%= config.bin %> unison markets --json"];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:markets";

  async execute(_io: CommandIO): Promise<Result> {
    return run(async () => {
      const { client } = publicReader();
      const now = BigInt(Math.floor(Date.now() / 1000));
      return { markets: (await readMarkets(client)).map((s) => describeMarket(s, now)) };
    });
  }

  override successHint(d: Result): string {
    const live = d.markets.filter((m) => m.reference && !m.rule.startsWith("old"));
    return live.map((m) => `${m.market}: ${m.reference} (Chainlink, ${m.referenceAgeSec}s ago), ${m.state}`).join("\n");
  }
}
