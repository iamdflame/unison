"use client";

import { TapeClient, type TapeSession } from "@unison/sdk/tape";
import { Check, Copy, Eye, EyeOff, Fingerprint, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "@/lib/ui/toast";
import type { Address, Hex } from "viem";
import { preloadSignIn, SignInSheet } from "@/components/app/SignInSheet";
import { Hallmark } from "@/components/ui/Hallmark";
import { MARKETS } from "@/lib/content/markets";
import { useStore } from "@/lib/store/createStore";
import { useVenue } from "@/lib/venue";
import type { NetConfig } from "@/lib/venue/config";
import { describeError, grantAgentKey, identity, revokeKey, session } from "@/lib/venue/identity";

/**
 * Agents. Every order in a batch gets the same price, so speed buys nothing: a person can let software trade for
 * them through a session key, inside caps the gateway contract enforces (markets, size and notional per order,
 * expiry). The key is shown as an object with its limits engraved on it, because the limits are the point.
 */
const E18 = 10n ** 18n;
const TTL = [
  ["1 hour", 3_600],
  ["1 day", 86_400],
  ["1 week", 604_800],
  ["30 days", 2_592_000],
] as const;

interface KeyView {
  key: string;
  expiry: number;
  maxQty: bigint;
  maxNotional: bigint;
  marketMask: bigint;
}

const tickersOf = (mask: bigint) => MARKETS.filter((m) => m.id < 256 && (mask >> BigInt(m.id)) & 1n).map((m) => m.ticker);
const short = (a: string) => `${a.slice(0, 6).toLowerCase()}…${a.slice(-4).toLowerCase()}`;

function until(expiry: number, now: number) {
  const s = expiry - now;
  if (s <= 0) return null;
  if (s < 3_600) return `${Math.ceil(s / 60)} min`;
  if (s < 172_800) return `${Math.round(s / 3_600)} h`;
  return `${Math.round(s / 86_400)} days`;
}

export function Agents() {
  const v = useVenue();
  const id = useStore(identity, (x) => x);
  const live = v.ready && v.mode === "live" && !!v.net;
  const [minted, setMinted] = useState<{ privateKey: Hex; address: Address; expiry: number; caps: KeyView } | null>(null);
  const [refresh, setRefresh] = useState(0);
  // An illustration only: a day-long key for two markets.
  const [example] = useState<KeyView>(() => ({
    key: "0x7a3fc1d26b9e4c0f8d15ae37b2c94f6e0d81a2c4",
    expiry: Math.floor(Date.now() / 1000) + 86_400,
    maxQty: 10n * E18,
    maxNotional: 5_000n * 10n ** 6n,
    marketMask: 0b11n,
  }));

  return (
    <div className="mx-auto max-w-[1680px] px-4 py-8 sm:px-6 lg:py-12 [&>*]:max-w-[1200px]">
      <header className="max-w-3xl">
        <h1 className="text-display-m text-ink">Agents</h1>
        <p className="text-lede mt-4 text-ink-2">
          Every order in a batch gets the same price, so a program has no edge over a person. Let software trade for you, inside limits
          you set and the contract enforces.
        </p>
      </header>

      <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {live && id ? (
          <Mint net={v.net!} onMinted={(m) => (setMinted(m), setRefresh((n) => n + 1))} />
        ) : live ? (
          <SignInPanel />
        ) : (
          <Panel title="What a key can do">
            <p className="text-ink-2">
              On a Unison network you mint a key here with one passkey signature, hand it to an agent, and revoke it
              whenever you like. You&apos;re in the simulation, so the key beside this is an example.
            </p>
            {/* the rulebook, as the gateway checks it on every order */}
            <dl className="mt-5 divide-y divide-line border-y border-line text-sm">
              {RULES.map(([can, what]) => (
                <div key={what} className="grid grid-cols-[88px_minmax(0,1fr)] gap-4 py-2.5">
                  <dt className={can ? "font-medium text-ink" : "font-medium text-halt"}>{can ? "Can" : "Never"}</dt>
                  <dd className="text-ink-2">{what}</dd>
                </div>
              ))}
            </dl>
            <Link
              href="/developers#agents-title"
              className="press mt-6 inline-flex items-center rounded-full bg-ink px-5 py-3 text-sm font-semibold text-bg"
            >
              Connect an agent
            </Link>
          </Panel>
        )}
        {minted ? (
          <Minted minted={minted} net={v.net!} account={id?.account ?? ""} />
        ) : (
          <KeyCard k={example} label="Example" />
        )}
      </div>

      {live && id ? <YourKeys net={v.net!} account={id.account} refresh={refresh} /> : null}
      <Tools />
    </div>
  );
}

/** What a session key may and may not do: OrderGateway's checks, in words. */
const RULES: [boolean, string][] = [
  [true, "Place and cancel orders for you, signed with its own key"],
  [true, "Trade only the markets you pick, each order within the size and notional you set"],
  [true, "Act until it expires or you revoke it, whichever comes first"],
  [false, "Withdraw your funds, or grant another key: both need your own signature"],
];

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel sm:p-7">
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SignInPanel() {
  const [open, setOpen] = useState(false);
  return (
    <Panel title="Sign in to mint a key">
      <p className="text-ink-2">Keys are granted by your passkey account: one Face ID, Touch ID or Windows Hello signature each.</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        onPointerEnter={preloadSignIn}
        onFocus={preloadSignIn}
        className="press mt-6 inline-flex items-center gap-2.5 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-bg"
      >
        <Fingerprint size={17} strokeWidth={1.5} aria-hidden /> Sign in
      </button>
      <SignInSheet open={open} onOpenChange={setOpen} />
    </Panel>
  );
}

/** The key as an object: who it is, what it may do, until when. */
function KeyCard({ k, label, browser, onRevoke, busy }: { k: KeyView; label?: string; browser?: boolean; onRevoke?: () => void; busy?: boolean }) {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const left = k.expiry === 0 ? null : until(k.expiry, now);
  const status = k.expiry === 0 ? "Revoked" : left ? "Active" : "Expired";
  const markets = tickersOf(k.marketMask);
  const qty = Number(k.maxQty) / 1e18;
  const notional = Number(k.maxNotional) / 1e6;
  return (
    <article className="relative overflow-hidden rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel sm:p-7" aria-label={`Session key ${short(k.key)}, ${status.toLowerCase()}`}>
      {/* engraved rose, as on a watch's papers: equal circles through one centre */}
      <svg className="pointer-events-none absolute -right-24 -bottom-28 size-64 text-champagne opacity-[0.22]" viewBox="0 0 200 200" aria-hidden>
        {Array.from({ length: 48 }, (_, i) => (
          <circle key={i} cx={(100 + 44 * Math.cos((i / 48) * Math.PI * 2)).toFixed(2)} cy={(100 + 44 * Math.sin((i / 48) * Math.PI * 2)).toFixed(2)} r="44" fill="none" stroke="currentColor" strokeWidth="0.45" />
        ))}
      </svg>
      <div className="relative flex items-center justify-between gap-3">
        <span className="dial-label text-ink-3">Session key</span>
        {label ? (
          <Hallmark>{label}</Hallmark>
        ) : (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status === "Active" ? "bg-buy-soft text-buy" : "bg-ink/[0.06] text-ink-3"}`}>
            {browser ? `${status} · this browser` : status}
          </span>
        )}
      </div>
      <p className="relative mt-4 font-mono text-[15px] text-ink">{short(k.key)}</p>
      <dl className="relative mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div>
          <dt className="text-ink-3">Markets</dt>
          <dd className="mt-0.5 text-ink">{markets.length === MARKETS.length ? "All" : markets.join(", ") || "None"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Expires</dt>
          <dd className="figures mt-0.5 text-ink">{status === "Active" ? `in ${left}` : status === "Revoked" ? "Revoked" : "Ended"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Size per order</dt>
          <dd className="figures mt-0.5 text-ink">up to {qty.toLocaleString("en-US", { maximumFractionDigits: 4 })}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Notional per order</dt>
          <dd className="figures mt-0.5 text-ink">up to ${notional.toLocaleString("en-US", { maximumFractionDigits: 2 })}</dd>
        </div>
        {/* the limits are per order: say what that means for the total, plainly */}
        <div className="col-span-2">
          <dt className="text-ink-3">In total</dt>
          <dd className="mt-0.5 text-ink">Not capped: any number of orders, as far as your free balance goes, until it expires.</dd>
        </div>
      </dl>
      <div className="relative mt-6 flex items-center justify-between gap-4 border-t border-line pt-4">
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <LockKeyhole size={15} strokeWidth={1.6} aria-hidden /> Places and cancels. Can never withdraw.
        </p>
        {onRevoke && status === "Active" ? (
          <button type="button" disabled={busy} onClick={onRevoke} className="press shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold text-halt hairline disabled:opacity-50">
            {busy ? "Revoking…" : "Revoke"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function Mint({ net, onMinted }: { net: NetConfig; onMinted: (m: { privateKey: Hex; address: Address; expiry: number; caps: KeyView }) => void }) {
  const id = useStore(identity, (x) => x);
  const listed = useMemo(() => MARKETS.filter((m) => net.deployment.markets[m.symbol]), [net]);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(listed.map((m) => m.id)));
  const [qtyText, setQtyText] = useState("10");
  const [notionalText, setNotionalText] = useState("5000");
  const [ttl, setTtl] = useState<number>(86_400);
  const [busy, setBusy] = useState(false);
  const qty = Number(qtyText);
  const notional = Number(notionalText);
  const ready = !!id && picked.size > 0 && qty > 0 && notional > 0 && !busy;

  const toggle = (marketId: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(marketId)) next.delete(marketId);
      else next.add(marketId);
      return next;
    });

  const mint = async () => {
    if (!ready || !id) return;
    setBusy(true);
    try {
      const marketIds = [...picked].map((i) => listed.find((m) => m.id === i)!).map((m) => net.deployment.markets[m.symbol]!.id);
      const maxQty = BigInt(Math.round(qty * 1e6)) * 10n ** 12n;
      const maxNotional = BigInt(Math.round(notional * 1e6));
      const r = await grantAgentKey(net, id, { maxQty, maxNotional, marketIds, ttlSeconds: ttl });
      const marketMask = marketIds.reduce((m, i) => m | (1n << BigInt(i)), 0n);
      onMinted({ ...r, caps: { key: r.address, expiry: r.expiry, maxQty, maxNotional, marketMask } });
      toast.success("Key minted", { description: "Copy it into your agent now. It's shown once." });
    } catch (e) {
      toast.error(await describeError(e).catch(() => (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Mint a key for an agent">
      <fieldset>
        <legend className="text-xs font-medium text-ink-3">Markets it may trade</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {listed.map((m) => (
            <button
              key={m.id}
              type="button"
              role="checkbox"
              aria-checked={picked.has(m.id)}
              onClick={() => toggle(m.id)}
              className={`press rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${picked.has(m.id) ? "bg-raised text-ink shadow-sm" : "bg-sunken text-ink-2 hover-fine:text-ink"}`}
            >
              {m.ticker}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-ink-3">Size per order, at most</span>
          <input inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value.replace(/[^\d.]/g, ""))} className="tnum mt-2 w-full rounded-2xl bg-sunken px-4 py-3 text-[15px] font-semibold text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-3">Notional per order, at most ($)</span>
          <input inputMode="decimal" value={notionalText} onChange={(e) => setNotionalText(e.target.value.replace(/[^\d.]/g, ""))} className="tnum mt-2 w-full rounded-2xl bg-sunken px-4 py-3 text-[15px] font-semibold text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus" />
        </label>
      </div>
      <fieldset className="mt-5">
        <legend className="text-xs font-medium text-ink-3">Expires after</legend>
        <div role="radiogroup" className="mt-2 grid grid-cols-4 gap-1 rounded-full bg-sunken p-1">
          {TTL.map(([label, s]) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={ttl === s}
              onClick={() => setTtl(s)}
              className={`press rounded-full py-2 text-sm font-medium transition-colors ${ttl === s ? "bg-raised text-ink shadow-sm" : "text-ink-2 hover-fine:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <button type="button" disabled={!ready} onClick={mint} className="press mt-6 flex w-full items-center justify-center gap-2.5 rounded-full bg-ink py-3.5 text-[15px] font-semibold text-bg transition-opacity disabled:opacity-40">
        <Fingerprint size={18} strokeWidth={1.5} aria-hidden /> {busy ? "Waiting for your passkey…" : "Mint key with passkey"}
      </button>
      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        The key pair is made in this browser. Unison never sees the private key; the gateway contract only learns its
        address and these limits.
      </p>
    </Panel>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          toast.error("Couldn't reach the clipboard.");
        }
      }}
      className="press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-2 hairline hover-fine:text-ink"
    >
      {done ? <Check size={13} strokeWidth={2} aria-hidden /> : <Copy size={13} strokeWidth={1.75} aria-hidden />}
      {done ? "Copied" : label}
    </button>
  );
}

function deploymentPath(net: NetConfig) {
  return net.network === "mainnet" ? "deployments/monad-mainnet.json" : net.network === "testnet" ? "deployments/monad-testnet.json" : "deployments/31337.json";
}

function Minted({ minted, net, account }: { minted: { privateKey: Hex; address: Address; caps: KeyView }; net: NetConfig; account: string }) {
  const [shown, setShown] = useState(false);
  const env: Record<string, string> = {
    DEPLOYMENT: deploymentPath(net),
    RPC_URL: net.rpcUrl,
    RELAYER_URL: net.relayerUrl,
    AGENT_ACCOUNT: account,
    AGENT_PRIVATE_KEY: minted.privateKey,
  };
  const masked = { ...env, AGENT_PRIVATE_KEY: shown ? minted.privateKey : `${minted.privateKey.slice(0, 6)}${"•".repeat(20)}` };
  const config = (e: Record<string, string>) =>
    JSON.stringify({ mcpServers: { unison: { command: "node", args: ["--conditions=development", "services/mcp/src/main.ts"], env: e } } }, null, 2);
  const cli = (e: Record<string, string>) =>
    `claude mcp add unison ${Object.entries(e)
      .map(([k, val]) => `-e ${k}=${val}`)
      .join(" ")} -- node --conditions=development services/mcp/src/main.ts`;
  return (
    <div className="space-y-4">
      <KeyCard k={minted.caps} label="New" />
      <section className="rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel sm:p-7" aria-label="Connect your agent">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold text-ink">Give it to your agent</h2>
          <button type="button" onClick={() => setShown((s) => !s)} className="press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-2 hairline hover-fine:text-ink">
            {shown ? <EyeOff size={13} strokeWidth={1.75} aria-hidden /> : <Eye size={13} strokeWidth={1.75} aria-hidden />} {shown ? "Hide key" : "Show key"}
          </button>
        </div>
        <p className="mt-2 text-sm text-ink-2">Shown once. Unison doesn&apos;t keep it. Run from a clone of the Unison repo:</p>
        <pre className="mt-4 overflow-x-auto rounded-2xl bg-sunken p-4 font-mono text-[12px] leading-relaxed text-ink">{cli(masked)}</pre>
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyButton text={cli(env)} label="Copy for Claude Code" />
          <CopyButton text={config(env)} label="Copy MCP config (JSON)" />
          <CopyButton text={minted.privateKey} label="Copy key only" />
        </div>
      </section>
    </div>
  );
}

function YourKeys({ net, account, refresh }: { net: NetConfig; account: string; refresh: number }) {
  const browserKey = useStore(session, (s) => s?.address.toLowerCase() ?? null);
  const id = useStore(identity, (x) => x);
  const [keys, setKeys] = useState<TapeSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let alive = true;
    const load = () =>
      new TapeClient(net.tapeUrl)
        .sessions(account)
        .then((s) => {
          if (!alive) return;
          setKeys(s);
          setNow(Math.floor(Date.now() / 1000));
        })
        .catch(() => alive && setKeys([]));
    void load();
    // the tape indexes a fresh grant within a block or two
    const again = setTimeout(load, 2500);
    return () => {
      alive = false;
      clearTimeout(again);
    };
  }, [net, account, refresh, tick]);

  if (keys === null) return null;
  const view = (s: TapeSession): KeyView => ({ key: s.key, expiry: s.expiry, maxQty: BigInt(s.maxQty), maxNotional: BigInt(s.maxNotional), marketMask: BigInt(s.marketMask) });
  const active = keys.filter((s) => s.expiry > now);
  const ended = keys.length - active.length;

  return (
    <section aria-labelledby="keys-title" className="mt-12">
      <h2 id="keys-title" className="text-[17px] font-semibold text-ink">
        Your keys
      </h2>
      {active.length === 0 ? (
        <p className="mt-3 text-sm text-ink-3">No active keys{ended ? `; ${ended} ended or revoked` : ""}.</p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {active.map((s) => (
            <KeyCard
              key={s.key}
              k={view(s)}
              browser={s.key.toLowerCase() === browserKey}
              busy={busy === s.key}
              onRevoke={async () => {
                if (!id) return;
                setBusy(s.key);
                try {
                  await revokeKey(net, id, s.key as Address);
                  toast.success("Key revoked", { description: "It can't place or cancel anything now." });
                  setTick((t) => t + 1);
                } catch (e) {
                  toast.error(await describeError(e).catch(() => (e as Error).message));
                } finally {
                  setBusy(null);
                }
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const TOOLS: [string, string][] = [
  ["markets", "Every market with its reference, session and last print."],
  ["market", "One market: reference, regime, the band a clear would use now, daily cap, liquidity sources."],
  ["depth", "Resting quantity per price level around the reference."],
  ["tape", "Recent auction prints, one uniform price per batch."],
  ["place_order", "A limit order for your account, signed with the session key and relayed without gas."],
  ["cancel_order", "Cancels one of your orders by slot."],
  ["order_status", "Where a relayed order is: queued, sent, done or failed."],
  ["my_orders", "Your open orders and their fills so far."],
  ["vault", "A market's vault: inventory, pending requests and P&L attribution."],
];

function Tools() {
  return (
    <section aria-labelledby="tools-title" className="mt-12 rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel sm:p-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <h2 id="tools-title" className="text-display-m text-ink">
            Nine tools, one set of limits.
          </h2>
          <p className="mt-4 text-ink-2">
            Unison&apos;s MCP server gives any agent that speaks the Model Context Protocol the venue&apos;s reads and two
            actions. Both actions are signed with the key you minted and checked against its limits, first by the relayer
            and again on-chain by the gateway.
          </p>
        </div>
        <dl className="divide-y divide-line">
          {TOOLS.map(([name, what]) => (
            <div key={name} className="grid grid-cols-[132px_minmax(0,1fr)] gap-4 py-3 text-sm">
              <dt className="font-mono text-[13px] text-ink">{name}</dt>
              <dd className="text-ink-2">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
