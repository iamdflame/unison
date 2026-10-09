"use client";

import { Check, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPublicClient, http, type Hex } from "viem";
import { type ReceiptVerification, verifyReceipt } from "@unison/sdk/verify";

/** What the page printed from the tape, so the chain can contradict it. */
export interface TapeSays {
  marketId: number;
  upTo: number;
  price: string;
  volume: string;
  receiptHash: string;
  rule?: string;
}

type State =
  | { phase: "checking" }
  | { phase: "done"; v: ReceiptVerification }
  | { phase: "missing" }
  | { phase: "error"; message: string };

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The fields the tape and the chain both state, and where they differ. */
function disagreements(v: ReceiptVerification, tape: TapeSays): string[] {
  const out: string[] = [];
  if (v.marketId !== BigInt(tape.marketId)) out.push(`market: the tape says ${tape.marketId}, the chain ${v.marketId}`);
  if (v.upToBlock !== BigInt(tape.upTo))
    out.push(`auction block: the tape says ${tape.upTo}, the chain ${v.upToBlock}`);
  if (v.price !== BigInt(tape.price)) out.push(`price: the tape says ${tape.price}, the chain ${v.price}`);
  if (v.volume !== BigInt(tape.volume)) out.push(`volume: the tape says ${tape.volume}, the chain ${v.volume}`);
  if (v.receiptHash.toLowerCase() !== tape.receiptHash.toLowerCase())
    out.push(`receipt hash: the tape says ${tape.receiptHash}, the chain ${v.receiptHash}`);
  const sameRule = !tape.rule || v.rule === tape.rule || (v.rule === "halted" && tape.rule !== "causal");
  if (!sameRule) out.push(`rule: the tape says ${tape.rule}, the chain ${v.rule}`);
  return out;
}

/**
 * The receipt, checked again by the reader's own browser against Monad's RPC: the same verifyReceipt that
 * verify-receipt.mjs runs, so the page's numbers are the tape's claim and this panel is the chain's answer. Key it by
 * the transaction: it checks once per mount.
 */
export function ReceiptCheck({ rpcUrl, tx, tape }: { rpcUrl: string; tx: Hex; tape: TapeSays }) {
  const [state, setState] = useState<State>({ phase: "checking" });
  const host = (() => {
    try {
      return new URL(rpcUrl).host;
    } catch {
      return rpcUrl;
    }
  })();

  useEffect(() => {
    let live = true;
    const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 2, timeout: 20_000 }) });
    verifyReceipt(client as never, tx)
      .then((v) => live && setState({ phase: "done", v }))
      .catch((e: { name?: string; shortMessage?: string; message?: string }) => {
        if (!live) return;
        // the RPC answered, and has no such transaction: the tape's record points at nothing
        if (e.name === "TransactionReceiptNotFoundError" || e.name === "NotAClearError") setState({ phase: "missing" });
        else setState({ phase: "error", message: e.shortMessage ?? e.message ?? String(e) });
      });
    return () => {
      live = false;
    };
  }, [rpcUrl, tx]);

  const v = state.phase === "done" ? state.v : null;
  const differ = v ? disagreements(v, tape) : [];
  const shown = v ? v.steps.filter((s) => s.kind !== "info") : [];

  return (
    <div
      className="rounded-[var(--radius-xl)] bg-raised p-5 shadow-panel"
      aria-live="polite"
      aria-busy={state.phase === "checking"}
    >
      <p className="text-xs font-medium text-ink-3">Checked by your browser, from {host}</p>
      {state.phase === "checking" ? (
        <p className="mt-2 text-sm text-ink-2 motion-safe:animate-pulse">
          Reading this auction and Chainlink&apos;s history from the chain…
        </p>
      ) : state.phase === "missing" ? (
        <div role="alert" className="mt-3 rounded-[var(--radius-lg)] bg-sell-soft p-3 text-sm text-ink">
          <p className="font-semibold">
            The chain has no auction at the transaction the tape names. The chain is the record.
          </p>
          <p className="mt-1 break-all text-ink-2">{tx}</p>
        </div>
      ) : state.phase === "error" ? (
        <p className="mt-2 text-sm text-ink-2">
          Your browser couldn&apos;t reach {host} ({state.message}). The command below runs the same checks from a
          terminal.
        </p>
      ) : (
        <>
          <p className={`mt-2 text-[15px] font-semibold ${v!.ok && differ.length === 0 ? "text-ink" : "text-sell"}`}>
            {v!.ok ? `All ${v!.checks} checks pass.` : `${v!.failures} of ${v!.checks} checks fail.`}{" "}
            <span className="font-normal text-ink-2">
              {v!.status === 3 || v!.rule === "halted"
                ? "Trading was stopped: nothing traded and every waiting order went back."
                : v!.rule === "causal"
                  ? "Priced at Chainlink's first observation after the orders."
                  : v!.rule === "discovery"
                    ? "A call auction while the market was closed, at Chainlink's last observation."
                    : "The older rule: a reference read at the clear."}
            </span>
          </p>
          {differ.length > 0 ? (
            <div role="alert" className="mt-3 rounded-[var(--radius-lg)] bg-sell-soft p-3 text-sm text-ink">
              <p className="font-semibold">The tape and the chain disagree. The chain is the record.</p>
              <ul className="mt-1 list-disc pl-5 text-ink-2">
                {differ.map((d) => (
                  <li key={d} className="break-words">
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul className="mt-4 grid gap-2 text-sm">
            {shown.map((s, i) => (
              <li key={i} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
                {s.kind === "check" ? (
                  s.ok ? (
                    <Check aria-label="passes" className="mt-0.5 size-4 text-buy" />
                  ) : (
                    <X aria-label="fails" className="mt-0.5 size-4 text-sell" />
                  )
                ) : (
                  <Minus aria-label={s.kind === "skip" ? "not checked" : "note"} className="mt-0.5 size-4 text-ink-3" />
                )}
                <span className={`break-words ${s.kind === "check" ? "text-ink" : "text-ink-3"}`}>
                  {sentence(s.what)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
