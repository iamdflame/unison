import { type Address, getAddress } from "viem";

/** The part of the host's wallet state the plugin reads (WalletStateSnapshot in @metamask/agent-sdk). */
interface WalletRef {
  id?: string;
  address?: string;
  name?: string;
}
export interface WalletState {
  selectedWallet?: { namespace?: string; ref?: WalletRef };
  remoteWallets?: { address: string; name?: string; namespace?: string }[];
  byokWallets?: { id: string; address: string; name?: string; namespace?: string }[];
}

/** The agent's selected EVM wallet, as `mm wallet select` set it; the only EVM wallet when none is selected. */
export function selectedEvmAddress(state: WalletState): Address | undefined {
  const evm = (w: { namespace?: string }) => (w.namespace ?? "evm") === "evm";
  const all = [...(state.remoteWallets ?? []), ...(state.byokWallets ?? [])].filter(evm);
  const sel = state.selectedWallet;
  if (sel?.ref && evm(sel)) {
    const r = sel.ref;
    const hit = r.address ? { address: r.address } : r.id ? state.byokWallets?.find((w) => w.id === r.id) : r.name ? all.find((w) => w.name === r.name) : undefined;
    if (hit?.address) return getAddress(hit.address);
  }
  return all.length === 1 ? getAddress(all[0]!.address) : undefined;
}
