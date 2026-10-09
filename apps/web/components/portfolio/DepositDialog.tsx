"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Wallet, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from "viem";
import { toast } from "@/lib/ui/toast";
import { useStore } from "@/lib/store/createStore";
import { useVenue } from "@/lib/venue";
import { identity } from "@/lib/venue/identity";
import { marketByTicker } from "@/lib/content/markets";
import { refreshAccount } from "@/lib/venue/live";

const venueAbi = parseAbi(["function depositFor(address account, address token, uint256 amount)"]);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const injected = () => (globalThis as { ethereum?: EIP1193Provider }).ethereum;

/**
 * Deposit from a wallet into the venue ledger, for the passkey account. A passkey account has no private key, so
 * nothing can be sent to its address directly; the wallet approves the venue and calls `depositFor`, which credits
 * the account. Two wallet confirmations (approve, deposit), or one when the allowance is already there.
 */
export function DepositDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const v = useVenue();
  const id = useStore(identity, (x) => x);
  const net = v.net;
  const assets = useMemo(
    () => Object.entries(net?.deployment.tokens ?? {}).map(([sym, t]) => ({ sym, address: t.address as Address, decimals: t.decimals })),
    [net],
  );
  const [sym, setSym] = useState("AUSD");
  const asset = assets.find((a) => a.sym === sym) ?? assets[0];
  const [from, setFrom] = useState<Address | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const amountId = useId();
  const reader = useMemo(() => (net ? createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) }) : null), [net]);

  // the connected wallet's balance of the chosen asset
  useEffect(() => {
    if (!from || !asset || !reader) return;
    let live = true;
    reader
      .readContract({ address: asset.address, abi: erc20Abi, functionName: "balanceOf", args: [from] })
      .then((b) => live && setBalance(b))
      .catch(() => live && setBalance(null));
    return () => {
      live = false;
    };
  }, [from, asset, reader]);

  const wallet = () => {
    const eth = injected();
    if (!eth || !net) throw new Error("No browser wallet here. Open this page in your wallet's browser (MetaMask, Rabby, Phantom, OKX), or on a computer with one.");
    return createWalletClient({ chain: net.chain, transport: custom(eth) });
  };

  const connect = async () => {
    setError(null);
    setBusy("connect");
    try {
      const w = wallet();
      const [a] = await w.requestAddresses();
      try {
        await w.switchChain({ id: net!.chain.id });
      } catch {
        await w.addChain({ chain: net!.chain });
      }
      setFrom(a ?? null);
    } catch (e) {
      setError((e as Error).message.split("\n")[0] ?? "The wallet didn't connect.");
    } finally {
      setBusy(null);
    }
  };

  let amount = 0n;
  try {
    amount = asset && amountText ? parseUnits(amountText, asset.decimals) : 0n;
  } catch {
    amount = 0n;
  }
  const problem =
    amountText && amount === 0n ? "Enter an amount." : balance !== null && amount > balance ? `Your wallet holds ${formatUnits(balance, asset!.decimals)} ${asset!.sym}.` : null;
  const ready = !!from && !!asset && !!id && amount > 0n && !problem && !busy;

  const submit = async () => {
    if (!ready || !net || !id || !asset || !reader || !from) return;
    setError(null);
    try {
      const w = wallet();
      const venue = net.deployment.exchange as Address;
      const allowance = await reader.readContract({ address: asset.address, abi: erc20Abi, functionName: "allowance", args: [from, venue] });
      if (allowance < amount) {
        setBusy("approve");
        const h = await w.writeContract({ account: from, address: asset.address, abi: erc20Abi, functionName: "approve", args: [venue, amount] });
        await reader.waitForTransactionReceipt({ hash: h });
      }
      setBusy("deposit");
      const h = await w.writeContract({ account: from, address: venue, abi: venueAbi, functionName: "depositFor", args: [id.account, asset.address, amount] });
      const r = await reader.waitForTransactionReceipt({ hash: h });
      if (r.status !== "success") throw new Error("The deposit reverted.");
      await refreshAccount(net);
      toast.success(`Deposited ${amountText} ${asset.sym}`, {
        description: net.explorer ? `${short(h)} on ${net.chain.name}` : short(h),
        action: net.explorer ? { label: "View", onClick: () => window.open(`${net.explorer}/tx/${h}`, "_blank", "noopener") } : undefined,
      });
      setAmountText("");
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message.split("\n")[0] ?? "The deposit didn't go through.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[3px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-[81] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-2xl)] bg-raised p-7 shadow-lg outline-none transition-[opacity,scale] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0">
          <Dialog.Close aria-label="Close" className="press absolute top-4 right-4 grid size-9 place-items-center rounded-full text-ink-3 hover-fine:bg-ink/[0.06]">
            <X size={16} strokeWidth={1.75} aria-hidden />
          </Dialog.Close>
          <Dialog.Title className="text-display-m text-ink">Deposit</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm leading-relaxed text-ink-2">
            From a wallet on {net?.chain.name ?? "Monad"} into your Unison account. Your wallet asks twice: once to let the
            venue take the amount, once to deposit it. Never send tokens to your account&apos;s address directly; they
            can&apos;t be recovered.
          </Dialog.Description>

          {!from ? (
            <button
              type="button"
              onClick={connect}
              disabled={!!busy}
              className="press mt-6 flex w-full items-center justify-center gap-2.5 rounded-[var(--radius-sm)] bg-ink py-3.5 text-[15px] font-semibold text-bg disabled:opacity-50"
            >
              <Wallet size={18} strokeWidth={1.5} aria-hidden /> {busy === "connect" ? "Waiting for your wallet…" : "Connect a wallet"}
            </button>
          ) : (
            <>
              <p className="mt-5 text-xs text-ink-3">
                From <span className="font-mono text-ink-2">{short(from)}</span>
              </p>
              <div role="radiogroup" aria-label="Asset" className="mt-4 flex flex-wrap gap-1.5">
                {assets.map((a) => (
                  <button
                    key={a.sym}
                    type="button"
                    role="radio"
                    aria-checked={a.sym === sym}
                    onClick={() => {
                      setSym(a.sym);
                      setBalance(null);
                    }}
                    className={`press rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors ${a.sym === sym ? "bg-thumb text-ink shadow-sm" : "bg-sunken text-ink-2 hover-fine:text-ink"}`}
                  >
                    {a.sym}
                  </button>
                ))}
              </div>
              <label htmlFor={amountId} className="mt-5 flex items-baseline justify-between text-xs font-medium text-ink-3">
                Amount
                {balance !== null && asset ? (
                  <span className="figures">
                    {Number(formatUnits(balance, asset.decimals)).toLocaleString("en-US", { maximumFractionDigits: 6 })} {asset.sym} in your wallet
                  </span>
                ) : null}
              </label>
              <div className="mt-2 flex items-center rounded-2xl bg-sunken pr-1.5">
                <input
                  id={amountId}
                  inputMode="decimal"
                  autoComplete="off"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="0.00"
                  aria-invalid={!!problem}
                  className="tnum w-full bg-transparent px-4 py-3 text-lg font-semibold text-ink outline-none placeholder:text-ink-3"
                />
                <button
                  type="button"
                  onClick={() => balance !== null && asset && setAmountText(formatUnits(balance, asset.decimals))}
                  className="press rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold text-ink-2 hover-fine:text-ink"
                >
                  Max
                </button>
              </div>
            </>
          )}

          <p aria-live="polite" className="mt-3 min-h-5 text-xs text-halt">
            {error ?? problem ?? ""}
          </p>

          {from ? (
            <button
              type="button"
              disabled={!ready}
              onClick={submit}
              className="press mt-3 flex w-full items-center justify-center gap-2.5 rounded-[var(--radius-sm)] bg-ink py-3.5 text-[15px] font-semibold text-bg transition-opacity disabled:opacity-40"
            >
              {busy === "approve" ? "Approve in your wallet…" : busy === "deposit" ? "Confirm the deposit in your wallet…" : `Deposit ${asset?.sym ?? ""}`}
            </button>
          ) : null}
          {asset && ["equity", "etf", "gold"].includes(marketByTicker(asset.sym)?.kind ?? "") ? (
            // the issuer's control over its own token, said before anyone deposits it
            <p className="mt-4 text-xs leading-relaxed text-ink-2">
              {asset.sym} is issued by Anchored, which can freeze it for addresses on its denylist. Unison checks that list
              when you deposit and when you withdraw, so a listed address can&apos;t take {asset.sym} out.
            </p>
          ) : null}
          <p className="mt-4 text-xs leading-relaxed text-ink-3">
            Beta: real assets, small vaults and daily caps. The contracts are not yet externally audited, and until a 7-day
            timelock is in place one team key administers them. Not offered to US persons, which the beta does not check
            on chain.
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
