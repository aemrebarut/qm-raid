// Link to src/workflow.ts (owned by raid-eng-flow; interface fixed in docs/lanes/eng-plan.md "Team workflows").
// Loaded at runtime so the engine runs with a stub until workflow.ts exists.
import type { Order, Workflow, WorkflowRun } from "../../../contract/types.ts";

export interface NodeBrief {
  runId: string; nodeId: string; role: string; instructions: string;
  previous: { nodeId: string; role: string; unitId: string; reply: string }[]; // latest last
}
export interface FlowHooks {
  startOrder(unitId: string, targetId: string, brief: NodeBrief): string | null;
  cancelOrder(orderId: string): void;
  setTargetStatus(targetId: string, status: "open" | "engaged" | "resolved"): void;
}
export interface FlowModule {
  initWorkflows(h: FlowHooks): void;
  presetWorkflow(preset: Workflow["preset"], members: string[]): Workflow | { error: string };
  validateWorkflow(w: Workflow, members: string[]): string | null;
  startRun(teamId: number, targetId: string): { ok: true; run: WorkflowRun } | { ok: false; error: string };
  onOrderEnded(order: Order): void;
  cancelRun(runId: string): { ok: true } | { ok: false; error: string };
  runForOrder(orderId: string): WorkflowRun | undefined;
  // E18 (optional): per-run data outside store.state as JSON, and back after a restart. loadRuns runs after
  // store.state (with workflowRuns) is restored and must link each run to the object in store.state.workflowRuns.
  saveRuns?(): unknown;
  loadRuns?(saved: unknown): void;
}

const NA = "team workflows are not available yet (src/workflow.ts missing)";
const stub: FlowModule = {
  initWorkflows() {},
  presetWorkflow: () => ({ error: NA }),
  validateWorkflow: () => NA,
  startRun: () => ({ ok: false, error: NA }),
  onOrderEnded() {},
  cancelRun: () => ({ ok: false, error: "unknown run" }),
  runForOrder: () => undefined,
};

export let flow: FlowModule = stub;
try {
  flow = (await import(new URL("./workflow.ts", import.meta.url).href)) as FlowModule;
} catch (err) {
  console.warn(`[engine] team workflows disabled: ${String(err).slice(0, 120)}`);
}

// game.ts links its hooks once; useFlow swaps the module (tests) and links the same hooks again.
let linked: FlowHooks | null = null;
export function linkWorkflows(h: FlowHooks): void {
  linked = h;
  flow.initWorkflows(h);
}
export function useFlow(m: FlowModule): void {
  flow = m;
  if (linked) m.initWorkflows(linked);
}
