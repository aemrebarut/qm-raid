// Local demo world used when the brain service is down. Synthetic data only.
import type { State, Unit, Target, UnitType } from "../../../contract/types.ts";
import { CLASS_MODELS } from "./config.ts";

export function builtinUnitTypes(): UnitType[] {
  return Object.entries(CLASS_MODELS).map(([id, c]) => ({
    id, name: c.name, source: "builtin", status: "ready", progress: 1, stage: "ready", model: c.model,
  }));
}

function unit(id: string, name: string, cls: string, team: number | null, x: number, y: number): Unit {
  const c = CLASS_MODELS[cls]!;
  return {
    id, name, class: cls, model: c.model, effort: c.effort, role: "worker",
    team, status: "idle", pos: { x, y }, orderId: null, qm: { sessionId: null, sessionUrl: null },
  };
}

function target(id: string, issue: string, title: string, component: string, kind: "bug" | "feature",
  severity: 1 | 2 | 3, x: number, y: number, customers: string[]): Target {
  return { id, issue, title, component, kind, severity, status: "open", pos: { x, y }, customers };
}

export function fixtureUnits(): Unit[] {
  return [
    unit("u1", "Ada", "knight", 1, 11, 14),
    unit("u2", "Bram", "ranger", 1, 12, 14),
    unit("u3", "Cato", "scout", 1, 13, 14),
    unit("u4", "Dara", "knight", 2, 11, 15),
    unit("u5", "Eno", "ranger", 2, 12, 15),
    unit("u6", "Fen", "scout", null, 13, 15),
  ];
}

export function fixtureState(): State {
  return {
    components: [
      { id: "billing", name: "Billing", zone: { x: 1, y: 1, w: 7, h: 6 } },
      { id: "auth", name: "Auth", zone: { x: 16, y: 1, w: 7, h: 6 } },
      { id: "search", name: "Search", zone: { x: 1, y: 9, w: 7, h: 6 } },
      { id: "notifications", name: "Notifications", zone: { x: 16, y: 9, w: 7, h: 6 } },
    ],
    buildings: [
      { id: "library", kind: "gbrain", x: 11, y: 11 },
      { id: "barracks", kind: "barracks", x: 20, y: 20 },
      { id: "forge", kind: "river", x: 3, y: 20 },
    ],
    units: fixtureUnits(),
    targets: [
      target("t12", "LUM-12", "Retry double-charges a card", "billing", "bug", 3, 4, 3, ["acme-robotics"]),
      target("t13", "LUM-13", "Invoice PDF shows wrong currency", "billing", "bug", 2, 2, 5, ["northwind-bakery"]),
      target("t14", "LUM-14", "Add annual plan discount", "billing", "feature", 1, 6, 2, []),
      target("t21", "LUM-21", "Session expires during checkout", "auth", "bug", 3, 18, 3, ["acme-robotics", "globex-freight"]),
      target("t22", "LUM-22", "Support passkey login", "auth", "feature", 2, 21, 5, ["globex-freight"]),
      target("t31", "LUM-31", "Search ignores accented letters", "search", "bug", 2, 3, 11, ["northwind-bakery"]),
      target("t32", "LUM-32", "Saved searches", "search", "feature", 1, 6, 13, []),
      target("t41", "LUM-41", "Duplicate password reset emails", "notifications", "bug", 3, 18, 11, ["acme-robotics"]),
      target("t42", "LUM-42", "Digest email opt out link broken", "notifications", "bug", 1, 21, 13, ["globex-freight"]),
    ],
    teams: [
      { id: 1, name: "Red", color: "#d64545", autopilot: false, members: ["u1", "u2", "u3"] },
      { id: 2, name: "Blue", color: "#3b7dd8", autopilot: false, members: ["u4", "u5"] },
    ],
    orders: [],
    unitTypes: builtinUnitTypes(),
    memory: { pages: 0, recent: [] },
    stats: { spentUsd: 0, tokens: 0 },
    backend: "mock",
  };
}
