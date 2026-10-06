"use client";

import { Dialog } from "@base-ui/react/dialog";
import { RelayerClient } from "@unison/sdk/relayer";
import { ArrowDownLeft, Droplets, Fingerprint, KeyRound, LogOut, X, Zap } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { toast } from "@/lib/ui/toast";
import { Emblem } from "@/components/brand/Emblem";
import { MARKETS } from "@/lib/content/markets";
import { useStore } from "@/lib/store/createStore";
import { createPasskey, identity, session, signInWithPasskey, signOut, startSession, warmSigner } from "@/lib/venue/identity";
import { useVenue, useVenueAccount } from "@/lib/venue";
import { networkName } from "@/lib/venue/config";
import { legacyRpIds } from "@/lib/venue/passkeyDomain";
import { refreshAccount } from "@/lib/venue/live";

/**
 * Sign-in is a passkey: Face ID, Touch ID or Windows Hello. No seed phrase and no gas. Then, on test networks,
 * one tap for test funds, and one more for a trading session (one signature now, one tap per order after).
 */
const DepositDialog = dynamic(() => import("@/components/portfolio/DepositDialog").then((m) => m.DepositDialog), { ssr: false });

export function SignIn({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const v = useVenue();
  const id = useStore(identity, (x) => x);
  const s = useStore(session, (x) => x);
  const quote = useVenueAccount((a) => a.quote);
  const [busy, setBusy] = useState<string | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  // a sign-in that found nothing offers the domains older passkeys were made for
  const [olderDomains, setOlderDomains] = useState<string[]>([]);
  const net = v.net;
  // the passkey prompt must not wait on the network (and lose its user activation): load the signer as the sheet opens
  useEffect(() => {
    if (open && v.mode === "live") warmSigner();
  }, [open, v.mode]);

  const run = (label: string, fn: () => Promise<unknown>, done?: string) => async () => {
    setBusy(label);
    try {
      await fn();
      if (done) toast.success(done);
    } catch (e) {
      toast.error((e as Error).message.split("\n")[0] ?? "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[3px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-[81] w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-2xl)] bg-raised p-7 shadow-lg outline-none transition-[opacity,scale] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0">
          <Dialog.Close aria-label="Close" className="press absolute top-4 right-4 grid size-9 place-items-center rounded-full text-ink-3 hover-fine:bg-ink/[0.06]">
            <X size={16} strokeWidth={1.75} aria-hidden />
          </Dialog.Close>
          <Emblem size={36} jewel />
          {v.mode !== "live" || !net ? (
            <>
              <Dialog.Title className="text-display-m mt-5 text-ink">You&apos;re in the simulation.</Dialog.Title>
              <Dialog.Description className="mt-3 text-sm leading-relaxed text-ink-2">
                Every batch here clears on the real engine in your browser, with a paper account. Live trading signs in
                with a passkey and needs a Unison network to talk to.
              </Dialog.Description>
            </>
          ) : !id ? (
            <>
              <Dialog.Title className="text-display-m mt-5 text-ink">Sign in with a passkey.</Dialog.Title>
              <Dialog.Description className="mt-3 text-sm leading-relaxed text-ink-2">
                Face ID, Touch ID or Windows Hello. No seed phrase, no gas. Your passkey is your account on {networkName(net.network)}.
              </Dialog.Description>
              <div className="mt-6 space-y-2">
                <button type="button" disabled={!!busy} onClick={run("create", () => createPasskey(net), "Your passkey account is ready.")} className="press flex w-full items-center justify-center gap-2.5 rounded-[var(--radius-sm)] bg-ink py-3.5 text-[15px] font-semibold text-bg disabled:opacity-50">
                  <Fingerprint size={18} strokeWidth={1.5} aria-hidden /> {busy === "create" ? "Creating…" : "Create a passkey"}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={run(
                    "signin",
                    () => signInWithPasskey(net).catch((e: unknown) => {
                      setOlderDomains(legacyRpIds());
                      throw e;
                    }),
                    "Welcome back.",
                  )}
                  className="press w-full rounded-[var(--radius-sm)] py-3 text-sm font-semibold text-ink hairline disabled:opacity-50"
                >
                  {busy === "signin" ? "Signing in…" : "I already have one"}
                </button>
                {olderDomains.map((rp) => (
                  <button
                    key={rp}
                    type="button"
                    disabled={!!busy}
                    onClick={run(`signin:${rp}`, () => signInWithPasskey(net, rp), "Welcome back.")}
                    className="press w-full rounded-[var(--radius-sm)] py-2.5 text-sm font-medium text-ink-2 hover-fine:text-ink disabled:opacity-50"
                  >
                    {busy === `signin:${rp}` ? "Signing in…" : `Use a passkey made on ${rp}`}
                  </button>
                ))}
              </div>
              <p className="mt-5 text-xs leading-relaxed text-ink-3">
                Your account lives in the venue&apos;s ledger at an address derived from your passkey. Fund it through
                Unison only: tokens sent straight to that address can&apos;t be recovered.
              </p>
            </>
          ) : (
            <>
              <Dialog.Title className="text-display-m mt-5 text-ink">Your account.</Dialog.Title>
              <Dialog.Description className="mt-2 font-mono text-xs break-all text-ink-3">{id.account}</Dialog.Description>
              <p className="numerals mt-5 text-3xl text-ink">
                ${quote.toLocaleString("en-US", { maximumFractionDigits: 2 })} <span className="font-sans text-sm text-ink-3">AUSD free</span>
              </p>
              <div className="mt-6 space-y-2">
                {net.faucet ? (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={run(
                      "faucet",
                      async () => {
                        const r = new RelayerClient(net.relayerUrl);
                        const { id: job } = await r.faucet(id.account);
                        await r.waitForJob(job);
                        await refreshAccount(net);
                      },
                      "Test funds deposited.",
                    )}
                    className="press flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-ink hairline disabled:opacity-50"
                  >
                    <Droplets size={17} strokeWidth={1.5} aria-hidden /> {busy === "faucet" ? "Depositing…" : "Add test funds"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      // one dialog at a time: the account sheet makes way for the deposit
                      onOpenChange(false);
                      setDepositOpen(true);
                    }}
                    className="press flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-ink hairline"
                  >
                    <ArrowDownLeft size={17} strokeWidth={1.5} aria-hidden /> Deposit from a wallet
                  </button>
                )}
                <button
                  type="button"
                  disabled={!!busy || !!s}
                  onClick={run(
                    "session",
                    () =>
                      startSession(net, id, {
                        maxQty: 1_000n * 10n ** 18n,
                        maxNotional: 250_000n * 10n ** 6n,
                        marketIds: MARKETS.filter((m) => net.deployment.markets[m.symbol]).map((m) => net.deployment.markets[m.symbol]!.id),
                      }),
                    "Trading session started. One tap per order for the next hour.",
                  )}
                  className="press flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-ink hairline disabled:opacity-50"
                >
                  {s ? <Zap size={17} strokeWidth={1.5} aria-hidden /> : <KeyRound size={17} strokeWidth={1.5} aria-hidden />}
                  {s ? `Trading session active until ${new Date(s.expiry * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : busy === "session" ? "Waiting for your passkey…" : "Start a trading session (one tap per order)"}
                </button>
                <button type="button" onClick={() => signOut()} className="press flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-ink-2 hover-fine:text-ink">
                  <LogOut size={17} strokeWidth={1.5} aria-hidden /> Sign out
                </button>
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
      {depositOpen ? <DepositDialog open={depositOpen} onOpenChange={setDepositOpen} /> : null}
    </Dialog.Root>
  );
}
