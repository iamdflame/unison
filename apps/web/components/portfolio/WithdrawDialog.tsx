"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Fingerprint, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "@/lib/ui/toast";
import { isAddress, parseUnits, type Address } from "viem";
import { shallowEqual, useStore } from "@/lib/store/createStore";
import { useVenue, useVenueAccount } from "@/lib/venue";
import { describeError, identity, withdrawFunds } from "@/lib/venue/identity";
import { refreshAccount } from "@/lib/venue/live";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Withdraw from the venue ledger to a wallet. Only the passkey can sign it (one Face ID); a trading session never
 * can, so a leaked session key can't move funds out.
 */
export function WithdrawDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void }) {
  const v = useVenue();
  const id = useStore(identity, (x) => x);
  const acct = useVenueAccount((a) => ({ quote: a.quote, base: a.base }), shallowEqual);
  const tokens = v.net?.deployment.tokens;
  const assets = useMemo(
    () =>
      Object.entries(tokens ?? {})
        .map(([sym, t]) => ({ sym, address: t.address as Address, decimals: t.decimals, free: sym === "AUSD" ? acct.quote : (acct.base[sym] ?? 0) }))
        .filter((a) => a.sym === "AUSD" || a.free > 0),
    [tokens, acct.quote, acct.base],
  );
  const [sym, setSym] = useState("AUSD");
  const [amountText, setAmountText] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountId = useId();
  const toId = useId();
  const asset = assets.find((a) => a.sym === sym) ?? assets[0];
  const amount = Number(amountText);

  const problem = !asset
    ? "Nothing to withdraw yet."
    : !(amount > 0)
      ? null
      : amount > asset.free + 1e-9
        ? `You have ${asset.free.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${asset.sym} free.`
        : to && !isAddress(to)
          ? "That isn't a valid address."
          : to && id && to.toLowerCase() === id.account.toLowerCase()
            ? "That's your Unison account. Send it to a wallet you control."
            : null;
  const ready = !!asset && amount > 0 && isAddress(to) && !problem && !busy;

  const submit = async () => {
    if (!ready || !v.net || !id || !asset) return;
    setBusy(true);
    setError(null);
    try {
      await withdrawFunds(v.net, id, asset.address, parseUnits(amountText, asset.decimals), to as Address);
      toast.success(`Withdrew ${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${asset.sym}`, { description: `To ${short(to)}.` });
      await refreshAccount(v.net);
      setAmountText("");
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      setError(await describeError(e).catch(() => (e as Error).message));
    } finally {
      setBusy(false);
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
          <Dialog.Title className="text-display-m text-ink">Withdraw</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm leading-relaxed text-ink-2">
            From your Unison account to a wallet you control. You confirm with your passkey; a trading session can&apos;t
            withdraw.
          </Dialog.Description>

          <div role="radiogroup" aria-label="Asset" className="mt-6 flex flex-wrap gap-1.5">
            {assets.map((a) => (
              <button
                key={a.sym}
                type="button"
                role="radio"
                aria-checked={a.sym === sym}
                onClick={() => setSym(a.sym)}
                className={`press rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${a.sym === sym ? "bg-ink text-bg" : "bg-sunken text-ink-2 hover-fine:text-ink"}`}
              >
                {a.sym}
              </button>
            ))}
          </div>

          <label htmlFor={amountId} className="mt-5 flex items-baseline justify-between text-xs font-medium text-ink-3">
            Amount
            {asset ? (
              <span className="figures">
                {asset.free.toLocaleString("en-US", { maximumFractionDigits: 6 })} {asset.sym} free
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
            <button type="button" onClick={() => asset && setAmountText(String(Math.floor(asset.free * 1e6) / 1e6))} className="press rounded-full px-3 py-1.5 text-xs font-semibold text-ink-2 hover-fine:text-ink">
              Max
            </button>
          </div>

          <label htmlFor={toId} className="mt-5 block text-xs font-medium text-ink-3">
            To
          </label>
          <input
            id={toId}
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            placeholder="0x… a wallet you control"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!to && !isAddress(to)}
            className="mt-2 w-full rounded-2xl bg-sunken px-4 py-3 font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-focus"
          />

          <p aria-live="polite" className="mt-3 min-h-5 text-xs text-halt">
            {error ?? problem ?? ""}
          </p>

          <button
            type="button"
            disabled={!ready}
            onClick={submit}
            className="press mt-3 flex w-full items-center justify-center gap-2.5 rounded-full bg-ink py-3.5 text-[15px] font-semibold text-bg transition-opacity disabled:opacity-40"
          >
            <Fingerprint size={18} strokeWidth={1.5} aria-hidden />
            {busy ? "Waiting for your passkey…" : "Withdraw with passkey"}
          </button>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
