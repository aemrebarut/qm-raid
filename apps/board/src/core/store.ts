// Typed client-side store: holds the engine State, applies SSE events, keeps per-unit activity feeds.
// State is mutated in place; subscribers are told after every change. Listeners never throw into the store.
import type { State, Unit, Target, Order, Team, EngineEvent, FeedEntry, Connection } from "./types";

const FEED_CAP = 200;

export interface Store {
  getState(): State;
  setState(state: State): void;
  apply(ev: EngineEvent): void;
  /** Called after any state change (snapshot or event). Returns an unsubscribe fn. */
  subscribe(fn: (state: State) => void): () => void;
  /** Raw engine events, called after the event has been applied to the state. */
  onEvent(fn: (ev: EngineEvent, state: State) => void): () => void;
  /** Activity feed for one unit, or the global feed when unitId is omitted. Newest last. */
  feed(unitId?: string): FeedEntry[];
  readonly connection: Connection;
  setConnection(c: Connection): void;
  onConnection(fn: (c: Connection) => void): () => void;
  unit(id: string | null | undefined): Unit | undefined;
  target(id: string | null | undefined): Target | undefined;
  order(id: string | null | undefined): Order | undefined;
  team(id: number | null | undefined): Team | undefined;
}

function upsert<T extends { id: string | number }>(list: T[], item: T): void {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
}

function normalize(s: State): State {
  // Be lenient with partial snapshots (fixtures, older engines).
  return {
    components: s.components ?? [], buildings: s.buildings ?? [], units: s.units ?? [], targets: s.targets ?? [],
    teams: s.teams ?? [], orders: s.orders ?? [], unitTypes: s.unitTypes ?? [],
    memory: { pages: s.memory?.pages ?? 0, recent: s.memory?.recent ?? [] },
    stats: { spentUsd: s.stats?.spentUsd ?? 0, tokens: s.stats?.tokens ?? 0 },
    backend: s.backend ?? "unknown",
  };
}

export function createStore(initial: State): Store {
  let state = normalize(initial);
  let connection: Connection = "connecting";
  const subs = new Set<(s: State) => void>();
  const evSubs = new Set<(ev: EngineEvent, s: State) => void>();
  const connSubs = new Set<(c: Connection) => void>();
  const feeds = new Map<string, FeedEntry[]>();
  const global: FeedEntry[] = [];

  const safe = <A extends unknown[]>(fns: Set<(...a: A) => void>, ...args: A) => {
    for (const fn of fns) {
      try { fn(...args); } catch (err) { console.error("[store] listener failed", err); }
    }
  };

  const pushFeed = (e: FeedEntry) => {
    let f = feeds.get(e.unitId);
    if (!f) feeds.set(e.unitId, (f = []));
    f.push(e);
    if (f.length > FEED_CAP) f.splice(0, f.length - FEED_CAP);
    global.push(e);
    if (global.length > FEED_CAP) global.splice(0, global.length - FEED_CAP);
  };

  const unit = (id: string | null | undefined) => (id ? state.units.find((u) => u.id === id) : undefined);

  function reduce(ev: EngineEvent): void {
    const ts = typeof ev.ts === "number" ? ev.ts : Date.now();
    switch (ev.type) {
      case "state.snapshot": {
        // Contract says {state}; tolerate a flattened snapshot too.
        const snap = (ev as any).state ?? ev;
        state = normalize(snap as State);
        return;
      }
      case "unit.spawned":
      case "unit.updated":
        upsert(state.units, ev.unit);
        return;
      case "unit.retired": {
        state.units = state.units.filter((u) => u.id !== ev.unitId);
        for (const t of state.teams) t.members = t.members.filter((m) => m !== ev.unitId);
        return;
      }
      case "unit.moved": {
        const u = unit(ev.unitId);
        if (u) u.pos = ev.pos;
        return;
      }
      case "unit.status": {
        const u = unit(ev.unitId);
        if (u) u.status = ev.status;
        return;
      }
      case "unit.activity":
        pushFeed({ ts, unitId: ev.unitId, kind: ev.kind, text: ev.text, tool: ev.tool });
        return;
      case "order.proposed":
      case "order.updated": {
        const prev = state.orders.find((o) => o.id === ev.order.id);
        upsert(state.orders, ev.order);
        const o = ev.order;
        if (!prev || prev.status !== o.status) {
          const t = state.targets.find((x) => x.id === o.targetId);
          pushFeed({ ts, unitId: o.unitId, kind: "order", text: `order ${o.status}: ${t ? `${t.issue} ${t.title}` : o.targetId}` });
        }
        if (o.reply && prev?.reply !== o.reply) pushFeed({ ts, unitId: o.unitId, kind: "reply", text: o.reply });
        return;
      }
      case "memory.recall":
        state.memory.recent.push({ ts, unitId: ev.unitId, op: "recall", slugs: ev.slugs, summary: ev.summary });
        pushFeed({ ts, unitId: ev.unitId, kind: "recall", text: ev.summary || ev.slugs.join(", ") });
        break;
      case "memory.remember":
        state.memory.recent.push({ ts, unitId: ev.unitId, op: "remember", slugs: [ev.slug], summary: ev.summary });
        state.memory.pages += 1; // approximate until the next snapshot or /api/brain/stats
        pushFeed({ ts, unitId: ev.unitId, kind: "remember", text: ev.summary || ev.slug });
        break;
      case "memory.link":
        state.memory.recent.push({ ts, unitId: "", op: "link", slugs: [ev.from, ev.to], summary: ev.linkType });
        break;
      case "target.updated":
        upsert(state.targets, ev.target);
        return;
      case "team.updated":
        upsert(state.teams, ev.team);
        return;
      case "stats":
        state.stats = { spentUsd: ev.spentUsd, tokens: ev.tokens };
        return;
      case "forge.updated":
        if (ev.unitType) upsert(state.unitTypes, ev.unitType);
        return;
      default:
        return; // unknown event types are ignored (forward compatible)
    }
    if (state.memory.recent.length > 100) state.memory.recent.splice(0, state.memory.recent.length - 100);
  }

  return {
    getState: () => state,
    setState(s) {
      state = normalize(s);
      safe(subs, state);
    },
    apply(ev) {
      if (!ev || typeof ev.type !== "string") return;
      try { reduce(ev); } catch (err) { console.error("[store] bad event", ev, err); return; }
      safe(evSubs, ev, state);
      safe(subs, state);
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    onEvent(fn) { evSubs.add(fn); return () => { evSubs.delete(fn); }; },
    feed(unitId) { return unitId ? feeds.get(unitId) ?? [] : global; },
    get connection() { return connection; },
    setConnection(c) {
      if (c === connection) return;
      connection = c;
      safe(connSubs, c);
    },
    onConnection(fn) { connSubs.add(fn); return () => { connSubs.delete(fn); }; },
    unit,
    target: (id) => (id ? state.targets.find((t) => t.id === id) : undefined),
    order: (id) => (id ? state.orders.find((o) => o.id === id) : undefined),
    team: (id) => (id == null ? undefined : state.teams.find((t) => t.id === id)),
  };
}
