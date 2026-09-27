// Board-side types: re-exports the shared contract (contract/types.ts is authoritative) plus board-only types.
export type {
  UnitStatus, UnitClass, Pos, Component, Building, UnitType, Unit, Target, Team, Order, MemoryOp, State, Customer,
  Proposal, EngineEvent, EngineEventType, ActivityKind,
} from "../../../../contract/types";
import type { ActivityKind } from "../../../../contract/types";

/** One line in a unit's activity feed (kept by the store, newest last). */
export interface FeedEntry {
  ts: number;
  unitId: string;
  kind: ActivityKind | "recall" | "remember" | "reply" | "order";
  text: string;
  tool?: string;
  /** Brain page slugs this line refers to (recall, remember, gbrain.* tool args), for bus.openPage. */
  slugs?: string[];
}

export type Connection = "connecting" | "live" | "reconnecting" | "fixture";
