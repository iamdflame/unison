"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { NetConfig } from "@/lib/venue/config";

interface Row {
  power: string;
  holders: string;
  note: string;
}

interface Read {
  rows: Row[];
  version: number;
  delay: number | null;
  vaultsUsd: number;
  potsUsd: number;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;

/**
 * Who can do what, and how much is at risk, read from the chain on every visit: the exchange's roles for every key the
 * deployment names, the owners of its price adapters, whether a new gateway needs an upgrade, the timelock's delay
 * once there is one, and the dollars in the vaults and the challenge pots. viem loads only after the page draws.
 */
export function Keys({ net }: { net: NetConfig }) {
  const [read, setRead] = useState<Read | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const { createPublicClient, http, keccak256, parseAbi, toHex, zeroHash } = await import("viem");
      const c = createPublicClient({ transport: http(net.rpcUrl, { retryCount: 2 }) });
      const d = net.deployment as unknown as Record<string, unknown> & typeof net.deployment;
      const ex = d.exchange as Address;
      const accounts = (d.accounts ?? {}) as Record<string, Address>;
      // every key the deployment names, by what it is
      const named: [string, Address | undefined][] = [
        ["the deployer", (accounts.deployer ?? d.admin) as Address | undefined],
        ["the guardian key", d.guardian as Address | undefined],
        ["the timelock", d.timelock as Address | undefined],
        ["the admin Safe", d.adminSafe as Address | undefined],
        ["the guardian Safe", d.guardianSafe as Address | undefined],
      ];
      const candidates = named.filter((x): x is [string, Address] => !!x[1]);
      const nameOf = (a: string) => candidates.find(([, k]) => k.toLowerCase() === a.toLowerCase())?.[0] ?? short(a);
      const exAbi = parseAbi([
        "function hasRole(bytes32, address) view returns (bool)",
        "function getRoleAdmin(bytes32) view returns (bytes32)",
        "function balanceOf(address, address) view returns (uint256)",
        "function version() view returns (uint256)",
        "function market(uint256) view returns ((address base, address quote, address refAdapter, uint8 baseIdx, uint8 quoteIdx, uint8 shards, bool active, bool permissioned, bool strictAfterClose, uint16 bandBps, uint16 feeBps, uint16 maxFeeBps, uint32 minTick, uint32 maxTick, uint32 maxBandTicks, uint64 baseUnit, uint64 tickSize, uint64 lastCleared, uint64 pendingHead, uint64 pendingTail, uint64 auctions, uint64 lastPrintTick, uint64 lastRefTimeMs, uint8 lastStatus, uint256 lastRefPrice, bytes32 receiptHash))",
      ]);
      const ownerAbi = parseAbi(["function owner() view returns (address)"]);
      const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
      const role = (name: string) => (name === "DEFAULT_ADMIN_ROLE" ? zeroHash : keccak256(toHex(name)));
      const holdersOf = async (r: string) => {
        const has = await Promise.all(candidates.map(([, a]) => c.readContract({ address: ex, abi: exAbi, functionName: "hasRole", args: [role(r), a] })));
        const names = candidates.filter((_, i) => has[i]).map(([n]) => n);
        return names.length ? names.join(", ") : "none of the named keys";
      };

      const [admin, operator, guardian, halt, cap, version, gatewayAdmin, gatewayHeld] = await Promise.all([
        holdersOf("DEFAULT_ADMIN_ROLE"),
        holdersOf("OPERATOR_ROLE"),
        holdersOf("GUARDIAN_ROLE"),
        holdersOf("HALT_ROLE"),
        holdersOf("CAP_ROLE"),
        c.readContract({ address: ex, abi: exAbi, functionName: "version" }).then(Number).catch(() => 1),
        c.readContract({ address: ex, abi: exAbi, functionName: "getRoleAdmin", args: [role("GATEWAY_ROLE")] }),
        d.gateway ? c.readContract({ address: ex, abi: exAbi, functionName: "hasRole", args: [role("GATEWAY_ROLE"), d.gateway as Address] }) : Promise.resolve(false),
      ]);
      const ownable: [string, Address | undefined][] = [
        ["Chainlink's feeds for the causal markets", d.causalReference as Address | undefined],
        ["the old-rule control's feed", d.chainlinkReference as Address | undefined],
        ["the issuer-denylist mirror", d.eligibility as Address | undefined],
      ];
      const owners = await Promise.all(
        ownable.map(([, a]) => (a ? c.readContract({ address: a, abi: ownerAbi, functionName: "owner" }).catch(() => null) : Promise.resolve(null))),
      );
      const delay = d.timelock
        ? Number(await c.readContract({ address: d.timelock as Address, abi: parseAbi(["function getMinDelay() view returns (uint256)"]), functionName: "getMinDelay" }).catch(() => 0n))
        : null;

      // the money: what each vault holds on the exchange's ledger at its market's last reference, and the pots
      const markets = Object.values(d.markets).filter((m) => m.vault);
      const vaultsUsd = (
        await Promise.all(
          markets.map(async (m) => {
            const [b, q, mk] = await Promise.all([
              c.readContract({ address: ex, abi: exAbi, functionName: "balanceOf", args: [m.vault!, m.base] }),
              c.readContract({ address: ex, abi: exAbi, functionName: "balanceOf", args: [m.vault!, m.quote] }),
              c.readContract({ address: ex, abi: exAbi, functionName: "market", args: [BigInt(m.id)] }),
            ]);
            const quoteDec = Object.values(d.tokens ?? {}).find((t) => t.address.toLowerCase() === m.quote.toLowerCase())?.decimals ?? 6;
            const price = Number(mk.lastRefPrice) / 10 ** quoteDec; // quote per whole base token
            return (Number(b) / Number(mk.baseUnit)) * price + Number(q) / 10 ** quoteDec;
          }),
        )
      ).reduce((a, x) => a + x, 0);
      const ch = d.challenge as { unison: Address; control: Address } | undefined;
      const ausd = d.tokens?.AUSD;
      const potsUsd =
        ch && ausd
          ? (await Promise.all([ch.unison, ch.control].map((a) => c.readContract({ address: ausd.address, abi: erc20, functionName: "balanceOf", args: [a] })))).reduce(
              (a, x) => a + Number(x) / 10 ** ausd.decimals,
              0,
            )
          : 0;

      const locked = gatewayAdmin !== zeroHash;
      const rows: Row[] = [
        { power: "Upgrade the exchange, and administer its roles", holders: admin, note: delay ? `through a ${Math.round(delay / 86_400)}-day public delay` : "at once: no timelock yet" },
        { power: "Change markets, bands, fees, sources, eligibility", holders: operator, note: delay ? "behind the same delay" : "at once" },
        { power: "Pause the exchange", holders: guardian, note: version >= 2 ? "returns every waiting order" : "holds sealed orders until it ends" },
        { power: "Halt a market", holders: halt, note: version >= 2 ? "returns every waiting order at once" : "returns them at the next auction" },
        { power: "Set daily caps", holders: cap, note: "" },
        {
          power: "Act for any account (a gateway, withdrawFor included)",
          holders: gatewayHeld ? "the OrderGateway (passkeys, signed orders)" : "no gateway",
          note: locked ? "a new one needs an upgrade" : "the admin can add one at once",
        },
        ...ownable.flatMap(([what], i) => (owners[i] ? [{ power: `Re-point ${what}`, holders: nameOf(owners[i]!), note: delay ? "behind the delay" : "at once" }] : [])),
      ];
      if (live) setRead({ rows, version, delay, vaultsUsd, potsUsd });
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [net]);

  return (
    <section aria-labelledby="keys-title" className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8 lg:px-12">
      <h2 id="keys-title" className="text-display-s text-ink">
        Keys and money at risk
      </h2>
      <p className="mt-3 max-w-3xl text-ink-2">
        Who can do what to this venue, read from the chain now. The full history of every key is in{" "}
        <a href="https://github.com/iamdflame/unison/blob/main/docs/evidence/mainnet.md#who-holds-which-key-read-from-the-chain-9-october-2026" className="text-ink underline decoration-line-strong underline-offset-4">
          the mainnet evidence
        </a>
        , and what each power could do to a user is in the threat model.
      </p>
      {failed ? (
        <p className="mt-5 text-sm text-ink-3">The chain didn&apos;t answer this time. Reload to read it again.</p>
      ) : !read ? (
        <p className="mt-5 text-sm text-ink-3 motion-safe:animate-pulse">Reading the keys from the chain…</p>
      ) : (
        <>
          <p className="mt-5 text-[15px] text-ink">
            <span className="font-semibold">{usd(read.vaultsUsd + read.potsUsd)} at risk:</span>{" "}
            <span className="text-ink-2">
              {usd(read.vaultsUsd)} in the vaults at their last prices, {usd(read.potsUsd)} in the challenge pots. Exchange
              version {read.version}; {read.delay ? `admin behind a ${Math.round(read.delay / 86_400)}-day timelock.` : "no timelock yet."}
            </span>
          </p>
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-[var(--radius-xl)] bg-raised text-sm shadow-panel">
            {read.rows.map((r) => (
              <li key={r.power} className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-4">
                <span className="text-ink-2">{r.power}</span>
                <span className="text-ink">{r.holders}</span>
                <span className="text-ink-3">{r.note}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
