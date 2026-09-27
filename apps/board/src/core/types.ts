// Board-side types: re-exports the shared contract and adds the engine SSE event union
// (not yet in contract/types.ts; mirrors docs/CONTRACT.md "GET /api/events").
export type {
  UnitStatus, UnitClass, Pos, Component, Building, UnitType, Unit, Target, Team, Order, MemoryOp, State, Customer,
  Proposal,
} from "../../../../contract/types";
import type { Pos, Unit, UnitStatus, Order, Target, Team, UnitType, State } from "../../../../contract/types";

export type ActivityKind = "message" | "tool" | "thinking" | "error";

type Ev<T extends string, P> = { seq?: number; ts?: number; type: T } & P; // ts = epoch ms

export type EngineEvent =
  | Ev<"state.snapshot", { state: State }>
  | Ev<"unit.spawned", { unit: Unit }>
  | Ev<"unit.updated", { unit: Unit }>
  | Ev<"unit.moved", { unitId: string; pos: Pos }>
  | Ev<"unit.status", { unitId: string; status: UnitStatus }>
  | Ev<"unit.activity", { unitId: string; kind: ActivityKind; text: string; tool?: string; args?: unknown }>
  | Ev<"order.proposed", { order: Order }>
  | Ev<"order.updated", { order: Order }>
  | Ev<"memory.recall", { unitId: string; slugs: string[]; summary: string }>
  | Ev<"memory.remember", { unitId: string; slug: string; summary: string }>
  | Ev<"memory.link", { from: string; to: string; linkType: string }>
  | Ev<"target.updated", { target: Target }>
  | Ev<"team.updated", { team: Team }>
  | Ev<"stats", { spentUsd: number; tokens: number }>
  | Ev<"forge.updated", { unitType: UnitType }>;

export type EngineEventType = EngineEvent["type"];

/** One line in a unit's activity feed (kept by the store, newest last). */
export interface FeedEntry {
  ts: number;
  unitId: string;
  kind: ActivityKind | "recall" | "remember" | "reply" | "order";
  text: string;
  tool?: string;
}

export type Connection = "connecting" | "live" | "reconnecting" | "fixture";
