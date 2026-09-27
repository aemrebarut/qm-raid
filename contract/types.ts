// Shared types for all services. Owned by the Analyst; ask before changing.
export type UnitStatus = "idle" | "moving" | "recalling" | "working" | "remembering" | "waiting_approval" | "error";
export type UnitClass = "knight" | "ranger" | "scout" | string; // string = a forged unit type id
export type Pos = { x: number; y: number };

export interface Component { id: string; name: string; zone: { x: number; y: number; w: number; h: number } }
export interface Building { id: string; kind: "gbrain" | "barracks" | "river"; x: number; y: number }
export interface UnitType { id: string; name: string; source: "builtin" | "forge"; status: "generating" | "training" | "evaluating" | "ready" | "failed"; progress: number; stage: string; model: string | null }
export interface Unit {
  id: string; name: string; class: UnitClass; model: string; effort: string; role: string;
  team: number | null; status: UnitStatus; pos: Pos; orderId: string | null;
  qm: { sessionId: string | null; sessionUrl: string | null };
  loadout?: Loadout;
}
export interface Loadout { instructions: string; skills: string[]; plugins: string[] } // instructions = the unit's system prompt / standing orders
export interface CatalogItem { id: string; name: string; description: string; kind: "skill" | "plugin" }
export interface Target {
  id: string; issue: string; title: string; component: string; kind: "bug" | "feature";
  severity: 1 | 2 | 3; status: "open" | "engaged" | "resolved"; pos: Pos; customers: string[];
}
export interface Customer { id: string; name: string; contact: string; contactSlug: string; slug: string } // slug = companies/<id>
export interface World { components: Component[]; buildings: Building[]; targets: Target[]; customers: Customer[] } // GET brain /world
// Team workflows: an agent graph inside a team (planner -> implementer -> reviewer, loops, fan-out).
export interface WorkflowNode { id: string; role: string; unitId: string; instructions?: string } // role: planner | implementer | reviewer | any label
export interface WorkflowEdge { from: string; to: string; on: "done" | "approved" | "changes" }
export interface Workflow { preset: "solo" | "pair" | "trio" | "fanout" | "recon" | "testfirst" | "herald" | "duel" | "custom"; entry: string; entries?: string[]; nodes: WorkflowNode[]; edges: WorkflowEdge[]; maxLoops: number }
export interface WorkflowStep { nodeId: string; unitId: string; orderId: string; status: "active" | "done" | "approved" | "changes" | "failed"; summary: string; ts: number }
export interface WorkflowRun { id: string; teamId: number; targetId: string; status: "running" | "done" | "needs_human" | "failed" | "cancelled"; loops: number; active: string[]; steps: WorkflowStep[] }
export interface Team { id: number; name: string; color: string; autopilot: boolean; members: string[]; workflow: Workflow | null }
export interface Order {
  id: string; unitId: string; targetId: string; status: "proposed" | "active" | "done" | "cancelled" | "failed";
  source: "user" | "autopilot" | "workflow"; runId?: string; nodeId?: string; teamId?: number /* set on an autopilot whole-team proposal (W3); going through starts that team's workflow run */; vetoDeadline: number | null; reply: string | null;
}
export interface MemoryOp { ts: number; unitId: string; op: "recall" | "remember" | "link"; slugs: string[]; summary: string }
export interface State {
  components: Component[]; buildings: Building[]; units: Unit[]; targets: Target[]; teams: Team[]; orders: Order[];
  unitTypes: UnitType[]; workflowRuns: WorkflowRun[]; memory: { pages: number; recent: MemoryOp[] }; stats: { spentUsd: number; tokens: number }; backend: string;
}

// Bridge API events (GET /events on qm-bridge and mock-bridge)
export type BridgeEvent =
  | { type: "activity"; unitId: string; orderId?: string; kind: "message" | "tool" | "thinking" | "error"; text: string; tool?: string; args?: unknown }
  | { type: "reply"; unitId: string; orderId?: string; text: string }
  | { type: "error"; unitId: string; orderId?: string; text: string }
  | { type: "usage"; unitId: string; tokens: number; usd: number };
export interface SpawnRequest { id: string; name: string; model: string; effort: string; role: string; team: number | null }
export interface SendRequest { text: string; orderId?: string; targetId?: string; componentId?: string }
export interface SpawnResponse { sessionId: string | null; sessionUrl: string | null }

// Proposer API (POST /propose on autopilot and commander)
export interface Proposal { unitId: string; targetId: string; reason: string }

// Engine SSE events (GET /api/events). Every message is one EngineEvent; ts is epoch ms.
export type ActivityKind = "message" | "tool" | "thinking" | "error";
type Ev<T extends string, P> = { seq: number; ts: number; type: T } & P;
export type EngineEvent =
  | Ev<"state.snapshot", { state: State }>
  | Ev<"unit.spawned", { unit: Unit }>
  | Ev<"unit.retired", { unitId: string }>
  | Ev<"unit.updated", { unit: Unit }>
  | Ev<"unit.moved", { unitId: string; pos: Pos }>
  | Ev<"unit.status", { unitId: string; status: UnitStatus }>
  | Ev<"unit.activity", { unitId: string; orderId?: string; kind: ActivityKind; text: string; tool?: string; args?: unknown }>
  | Ev<"order.proposed", { order: Order }>
  | Ev<"order.updated", { order: Order }>
  | Ev<"memory.recall", { unitId: string; slugs: string[]; summary: string }>
  | Ev<"memory.remember", { unitId: string; slug: string; summary: string }>
  | Ev<"memory.link", { from: string; to: string; linkType: string }>
  | Ev<"target.updated", { target: Target }>
  | Ev<"target.spawned", { target: Target }>
  | Ev<"team.updated", { team: Team }>
  | Ev<"stats", { spentUsd: number; tokens: number }>
  | Ev<"forge.updated", { unitType: UnitType }>
  | Ev<"workflow.updated", { run: WorkflowRun }>
  | Ev<"workflow.handoff", { runId: string; fromUnitId: string; toUnitId: string; nodeId: string; summary: string }>;
export type EngineEventType = EngineEvent["type"];
