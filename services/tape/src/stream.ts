/**
 * Live fan-out for the SSE endpoint: every published event is kept in a 10-minute ring so a client that
 * reconnects with Last-Event-ID gets exactly what it missed.
 *
 * Ids are "<block>:<logIndex>" ("<block>:-1" for heads). Replay continues after the matching id in publication
 * order; when the id has already left the ring, it falls back to (block, logIndex) order.
 */

export interface HubEvent {
  seq: number;
  id: string;
  block: number;
  logIndex: number;
  event: string;
  /** serialized JSON */
  data: string;
  topics: readonly string[];
  at: number;
}

export interface HubOptions {
  windowMs?: number;
  maxEvents?: number;
  now?: () => number;
}

type Listener = (e: HubEvent) => void;

/** "prints:0" stays as is; account topics are lowercased; empty entries dropped. */
export function parseTopics(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of (raw ?? "").split(",")) {
    const s = t.trim();
    if (!s) continue;
    out.add(s.startsWith("account:") ? s.toLowerCase() : s);
  }
  return out;
}

const parseId = (id: string): [number, number] | undefined => {
  const m = /^(\d+):(-?\d+)$/.exec(id.trim());
  return m ? [Number(m[1]), Number(m[2])] : undefined;
};

export class StreamHub {
  private readonly ring: HubEvent[] = [];
  private readonly listeners = new Map<Listener, Set<string>>();
  private seq = 0;
  private readonly windowMs: number;
  private readonly maxEvents: number;
  private readonly now: () => number;

  constructor(opts: HubOptions = {}) {
    this.windowMs = opts.windowMs ?? 600_000;
    this.maxEvents = opts.maxEvents ?? 200_000;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.ring.length;
  }

  get subscribers(): number {
    return this.listeners.size;
  }

  publish(event: string, block: number, logIndex: number, data: unknown, topics: readonly string[]): HubEvent {
    const e: HubEvent = {
      seq: ++this.seq,
      id: `${block}:${logIndex}`,
      block,
      logIndex,
      event,
      data: JSON.stringify(data),
      topics,
      at: this.now(),
    };
    this.ring.push(e);
    this.prune();
    for (const [fn, want] of this.listeners) if (matches(e, want)) fn(e);
    return e;
  }

  private prune() {
    const cutoff = this.now() - this.windowMs;
    let drop = 0;
    while (drop < this.ring.length && (this.ring[drop]!.at < cutoff || this.ring.length - drop > this.maxEvents)) drop++;
    if (drop) this.ring.splice(0, drop);
  }

  subscribe(topics: Set<string>, fn: Listener): () => void {
    this.listeners.set(fn, topics);
    return () => void this.listeners.delete(fn);
  }

  /** Events after `lastEventId` matching `topics`, in publication order. */
  replay(lastEventId: string, topics: Set<string>): HubEvent[] {
    this.prune();
    let start = -1;
    for (let i = this.ring.length - 1; i >= 0; i--) {
      if (this.ring[i]!.id === lastEventId) {
        start = i + 1;
        break;
      }
    }
    let candidates: HubEvent[];
    if (start >= 0) candidates = this.ring.slice(start);
    else {
      const pos = parseId(lastEventId);
      if (!pos) return [];
      candidates = this.ring.filter((e) => e.block > pos[0] || (e.block === pos[0] && e.logIndex > pos[1]));
    }
    return candidates.filter((e) => matches(e, topics));
  }
}

function matches(e: HubEvent, want: Set<string>): boolean {
  for (const t of e.topics) if (want.has(t)) return true;
  return false;
}
