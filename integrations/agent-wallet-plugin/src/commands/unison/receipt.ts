import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { publicReader, run } from "../../lib/host.ts";
import { checkReceipt, resolveClearTx } from "../../lib/receipt.ts";

const inputs = {
  ref: {
    type: InputFieldType.Text,
    flag: "ref",
    message: "The auction: its clear transaction, its receipt link, or a market id",
    required: true,
    prompt: false,
    index: 0,
  },
  upTo: {
    type: InputFieldType.Text,
    flag: "up-to",
    message: "With a market id: the block its batch ran up to",
    required: false,
    prompt: false,
    index: 1,
  },
} satisfies InputSchema;

type Result = Awaited<ReturnType<typeof checkReceipt>>;

export default class UnisonReceipt extends PluginCommand<Result> {
  static override description =
    "Checks an auction from the chain alone: its receipt hash recomputes, and the price is Chainlink's first observation after the newest order was sealed, proven against Chainlink's own history.";
  static override examples = [
    "<%= config.bin %> unison receipt https://www.unisonfi.com/receipt/mainnet/1/111055816",
    "<%= config.bin %> unison receipt 1 111055816",
    "<%= config.bin %> unison receipt 0x128b8b18f4ae90cf0f79f439f5886f2f3ff548f2ebb3dcd7a847c2284351596e --json",
  ];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "unison:receipt";

  async execute(io: CommandIO): Promise<Result> {
    return run(async () => {
      const i = await io.resolveInputs(inputs);
      const { client } = publicReader();
      const tx = await resolveClearTx(client, i.ref, i.upTo || undefined);
      return checkReceipt(client, tx);
    });
  }

  override successHint(d: Result): string {
    return [...d.checks, d.verified ? `\nVerified: ${d.passed} of ${d.of} checks pass. ${d.receipt}` : `\n${d.of - d.passed} check(s) failed.`].join("\n");
  }
}
