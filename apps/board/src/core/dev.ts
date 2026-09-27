// Dev helpers for building UI before the engine emits the matching events (console: raid.dev.*).
// They only apply synthetic events to the local store; nothing is sent to the engine.
import type { Store } from "./store";
import type { Order, Target, UnitStatus, WorkflowRun, WorkflowStep } from "./types";

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
    /** A handoff scroll between two units. */
    handoff(fromUnitId = "u1", toUnitId = "u2", summary = "Plan: 1. reproduce 2. fix 3. add a test") {
      store.apply({ seq: seq(), ts: now(), type: "workflow.handoff", runId: "dev-run", fromUnitId, toUnitId, nodeId: "n2", summary });
    },
    /** Simulate a whole workflow run for a team locally (follows its graph; reviewer asks for changes once). */
    workflow(teamId = 1, targetId?: string, stepMs = 2500): string | null {
      const team = store.team(teamId);
      const wf = team?.workflow;
      if (!wf) return null;
      const s = store.getState();
      const t = targetId ? store.target(targetId) : s.targets.find((x) => x.status === "open");
      if (!t) return null;
      // One run per team: the simulated run replaces any running one (e.g. the fixture run).
      for (const r of s.workflowRuns.filter((x) => x.teamId === teamId && x.status === "running")) {
        store.apply({ seq: seq(), ts: now(), type: "workflow.updated", run: { ...structuredClone(r), status: "cancelled", active: [] } });
      }
      const run: WorkflowRun = { id: `dev-w${n + 1}`, teamId, targetId: t.id, status: "running", loops: 0, active: [wf.entry], steps: [] };
      const emit = () => store.apply({ seq: seq(), ts: now(), type: "workflow.updated", run: structuredClone(run) });
      const node = (id: string) => wf.nodes.find((x) => x.id === id)!;
      let reviews = 0;
      const visit = (nodeId: string) => {
        const nd = node(nodeId);
        const step: WorkflowStep = { nodeId, unitId: nd.unitId, orderId: `dev-o${n + 1}`, status: "active", summary: "", ts: now() };
        run.steps.push(step);
        run.active = [nodeId];
        emit();
        setTimeout(() => {
          let on: "done" | "approved" | "changes" = "done";
          if (nd.role === "reviewer") on = reviews++ === 0 && run.loops < wf.maxLoops ? "changes" : "approved";
          step.status = on === "done" ? "done" : on;
          step.summary = on === "changes" ? "VERDICT: CHANGES: add a regression test" : on === "approved" ? "VERDICT: APPROVED" : `${nd.role} finished`;
          const next = wf.edges.find((e) => e.from === nodeId && e.on === on);
          if (on === "changes") run.loops++;
          if (!next) { run.status = "done"; run.active = []; emit(); return; }
          store.apply({ seq: seq(), ts: now(), type: "workflow.handoff", runId: run.id, fromUnitId: nd.unitId, toUnitId: node(next.to).unitId, nodeId: next.to, summary: step.summary });
          visit(next.to);
        }, stepMs);
      };
      visit(wf.entry);
      return run.id;
    },
    /** A new camp rises in a zone (target.spawned) on a free tile. */
    issue(componentId?: string, title = "Synthetic issue from raid.dev"): Target | null {
      const s = store.getState();
      const c = componentId ? s.components.find((x) => x.id === componentId) : s.components[n % Math.max(1, s.components.length)];
      if (!c) return null;
      const taken = new Set([...s.targets, ...s.units].map((x) => `${x.pos.x},${x.pos.y}`));
      let pos = { x: c.zone.x + 1, y: c.zone.y + 1 };
      for (let y = c.zone.y + 1; y < c.zone.y + c.zone.h - 1; y++) for (let x = c.zone.x + 1; x < c.zone.x + c.zone.w - 1; x++) {
        if (!taken.has(`${x},${y}`)) { pos = { x, y }; y = Infinity; break; }
      }
      const num = 900 + ++n;
      const target: Target = { id: `dev-t${num}`, issue: `LUM-${num}`, title, component: c.id, kind: "bug", severity: 2, status: "open", pos, customers: [] };
      store.apply({ seq: seq(), ts: now(), type: "target.spawned", target });
      return target;
    },
    status(unitId: string, status: UnitStatus) {
      store.apply({ seq: seq(), ts: now(), type: "unit.status", unitId, status });
    },
  };
}
