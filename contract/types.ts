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
}
export interface Target {
  id: string; issue: string; title: string; component: string; kind: "bug" | "feature";
  severity: 1 | 2 | 3; status: "open" | "engaged" | "resolved"; pos: Pos; customers: string[];
}
export interface Customer { id: string; name: string; contact: string; contactSlug: string; slug: string } // slug = companies/<id>
export interface World { components: Component[]; buildings: Building[]; targets: Target[]; customers: Customer[] } // GET brain /world
export interface Team { id: number; name: string; color: string; autopilot: boolean; members: string[] }
export interface Order {
  id: string; unitId: string; targetId: string; status: "proposed" | "active" | "done" | "cancelled" | "failed";
  source: "user" | "autopilot"; vetoDeadline: number | null; reply: string | null;
}
export interface MemoryOp { ts: number; unitId: string; op: "recall" | "remember" | "link"; slugs: string[]; summary: string }
export interface State {
  components: Component[]; buildings: Building[]; units: Unit[]; targets: Target[]; teams: Team[]; orders: Order[];
  unitTypes: UnitType[]; memory: { pages: number; recent: MemoryOp[] }; stats: { spentUsd: number; tokens: number }; backend: string;
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
