// Dev helpers for building UI before the engine emits the matching events (console: raid.dev.*).
// They only apply synthetic events to the local store; nothing is sent to the engine.
import type { Store } from "./store";
import type { Order, UnitStatus } from "./types";

let n = 0;

export function devTools(store: Store) {
  const now = () => Date.now();
  const seq = () => -(++n); // negative seq marks synthetic events
  return {
    /** Inject an autopilot proposal (first idle unit to the nearest open target) with a 15 s veto window. */
    propose(unitId?: string, targetId?: string): Order | null {
      const s = store.getState();
      const u = unitId ? store.unit(unitId) : s.units.find((x) => x.status === "idle");
      if (!u) return null;
      const open = s.targets.filter((t) => t.status === "open");
      const dist = (t: { pos: { x: number; y: number } }) => Math.abs(t.pos.x - u.pos.x) + Math.abs(t.pos.y - u.pos.y);
      const t = targetId ? store.target(targetId) : open.sort((a, b) => dist(a) - dist(b))[0];
      if (!t) return null;
      const order: Order = { id: `dev-o${n + 1}`, unitId: u.id, targetId: t.id, status: "proposed", source: "autopilot", vetoDeadline: now() + 15000, reply: null };
      store.apply({ seq: seq(), ts: now(), type: "order.proposed", order });
      return order;
    },
    recall(unitId = "u1") {
      store.apply({ seq: seq(), ts: now(), type: "memory.recall", unitId, slugs: ["components/billing", "issues/lum-101"], summary: "Recalled the billing house rule" });
    },
    remember(unitId = "u1") {
      store.apply({ seq: seq(), ts: now(), type: "memory.remember", unitId, slug: `learnings/dev-${unitId}-${now()}`, summary: "Remembered a learning" });
    },
    status(unitId: string, status: UnitStatus) {
      store.apply({ seq: seq(), ts: now(), type: "unit.status", unitId, status });
    },
  };
}
