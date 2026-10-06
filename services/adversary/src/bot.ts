/**
 * The house adversary. It is meant to win: it watches MON's price on public exchanges and, the moment that price has
 * moved further from Chainlink's latest landed round than the vaults' spread and fee, it trades in the direction of
 * the move, on two markets at once, through its accounts in the standing challenge:
 *   - Unison's WMON/AUSD, where an auction prices at the first Chainlink observation after its orders (SPEC §7.4);
 *   - the control, WMON/AUSD on the older rule, where an auction prices at whatever round has landed when it clears.
 * Same signal, same size, same vault settings; only the rule differs. Every fill is on the record, and every so often
 * the bot scores both accounts against Chainlink's history and claims any pot whose definition it meets.
 *
 * It is labelled as the team's in every count of outside demand; it is eligible for the pots so that the challenge's
 * definition is shown to pay where there is an edge.
 */
import type { Address, Hex } from "viem";

export type Side = 0 | 1; // 0 buys WMON, 1 sells it

/** What the bot needs from the chain, injectable so the policy is testable. */
export interface Chain {
  /** Chainlink's latest landed MON/USD round: price (quote units per whole token) and round id */
  latest(): Promise<{ price: bigint; round: bigint }>;
  /** whether an account's order is still open (waiting for its auction or not yet recorded) */
  orderOpen(account: Address): Promise<boolean>;
  /** sends an auction order through a challenge account */
  order(account: Address, side: Side, tick: bigint, qty: bigint): Promise<Hex>;
  /** records an open order's fill once its auction has ran; false when it hasn't yet */
  settle(account: Address): Promise<boolean>;
}

export interface Leg {
  name: "unison" | "control";
  account: Address;
}

export interface AdversaryConfig {
  chain: Chain;
  legs: readonly Leg[];
  /** fire when the exchange price is this far from Chainlink's latest landed round */
  thresholdBps: number;
  /** base units per order, on each leg */
  qty: bigint;
  /** quote units per tick (WMON/AUSD: 1, a millionth of an AUSD) */
  tickSize: bigint;
  /** how far past the exchange price the limit goes, so a real move fills */
  slippageBps: number;
  log?: (m: Record<string, unknown>) => void;
}

/** The decision, alone: trade toward the exchange price when it has left Chainlink's last landed round behind. */
export function signal(exchange: number, chainlink: number, thresholdBps: number): Side | null {
  if (!(exchange > 0) || !(chainlink > 0)) return null;
  const gapBps = (exchange / chainlink - 1) * 10_000;
  if (gapBps >= thresholdBps) return 0;
  if (gapBps <= -thresholdBps) return 1;
  return null;
}

export class Adversary {
  readonly cfg: AdversaryConfig;
  private busy = false;
  /** the Chainlink round the last trade was made against: one trade per move */
  private lastRound = -1n;
  readonly stats = { fired: 0, settled: 0, errors: 0 };

  constructor(cfg: AdversaryConfig) {
    this.cfg = cfg;
  }

  private log(m: Record<string, unknown>) {
    const line = { t: new Date().toISOString(), ...m };
    if (this.cfg.log) this.cfg.log(line);
    else console.log(JSON.stringify(line, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
  }

  /**
   * A new exchange price (USD per MON). Trades on both legs at once if the price has moved past the threshold from
   * Chainlink's latest landed round, no order is open, and this round hasn't been traded against already.
   */
  async onPrice(usd: number): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const { chain, legs } = this.cfg;
      const open = await Promise.all(legs.map((l) => chain.orderOpen(l.account)));
      if (open.some(Boolean)) return false;
      const { price, round } = await chain.latest();
      if (round === this.lastRound) return false;
      const chainlink = Number(price) / 1e6; // AUSD has 6 decimals
      const side = signal(usd, chainlink, this.cfg.thresholdBps);
      if (side === null) return false;
      const limitUsd = usd * (1 + ((side === 0 ? 1 : -1) * this.cfg.slippageBps) / 10_000);
      const tick = BigInt(Math.round((limitUsd * 1e6) / Number(this.cfg.tickSize)));
      this.lastRound = round;
      this.stats.fired++;
      const txs = await Promise.all(legs.map((l) => chain.order(l.account, side, tick, this.cfg.qty)));
      this.log({
        action: "fire",
        side: side === 0 ? "buy" : "sell",
        exchangeUsd: usd,
        chainlinkUsd: chainlink,
        gapBps: Math.round((usd / chainlink - 1) * 10_000 * 10) / 10,
        round,
        tick,
        txs,
      });
      return true;
    } catch (e) {
      this.stats.errors++;
      this.log({ level: "warn", action: "fire", error: (e as Error).message.split("\n")[0] });
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** Records every leg whose auction has run. */
  async settle(): Promise<number> {
    let n = 0;
    for (const l of this.cfg.legs) {
      try {
        if (!(await this.cfg.chain.orderOpen(l.account))) continue;
        if (await this.cfg.chain.settle(l.account)) {
          n++;
          this.stats.settled++;
          this.log({ action: "settled", leg: l.name });
        }
      } catch (e) {
        this.stats.errors++;
        this.log({ level: "warn", action: "settle", leg: l.name, error: (e as Error).message.split("\n")[0] });
      }
    }
    return n;
  }
}
