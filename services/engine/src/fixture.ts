// Local demo world used when the brain service is down; mirrors the brain world (world/layout.json). Synthetic data only.
import type { Loadout, State, Unit, Target, UnitType } from "../../../contract/types.ts";
import { CLASS_MODELS } from "./config.ts";

export function builtinUnitTypes(): UnitType[] {
  return Object.entries(CLASS_MODELS).map(([id, c]) => ({
    id, name: c.name, source: "builtin", status: "ready", progress: 1, stage: "ready", model: c.model,
  }));
}

// Every unit starts with no standing orders, no extra skills and GBrain as its one plugin (PATCH /api/units/:id changes it).
export function defaultLoadout(): Loadout {
  return { instructions: "", skills: [], plugins: ["gbrain"] };
}

function unit(id: string, name: string, cls: string, team: number | null, x: number, y: number): Unit {
  const c = CLASS_MODELS[cls]!;
  return {
    id, name, class: cls, model: c.model, effort: c.effort, role: "worker",
    team, status: "idle", pos: { x, y }, orderId: null, qm: { sessionId: null, sessionUrl: null }, loadout: defaultLoadout(),
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
      { id: "billing", name: "Billing", zone: { x: 1, y: 1, w: 8, h: 7 } },
      { id: "auth", name: "Auth", zone: { x: 15, y: 1, w: 8, h: 7 } },
      { id: "onboarding", name: "Onboarding", zone: { x: 1, y: 10, w: 7, h: 7 } },
      { id: "search", name: "Search", zone: { x: 16, y: 10, w: 7, h: 7 } },
    ],
    buildings: [
      { id: "library", kind: "gbrain", x: 11, y: 11 },
      { id: "barracks", kind: "barracks", x: 20, y: 20 },
      { id: "forge", kind: "river", x: 3, y: 20 },
    ],
    units: fixtureUnits(),
    targets: [
      target("t101", "LUM-101", "Payment retry double-charges a card", "billing", "bug", 3, 3, 3, ["acme-robotics"]),
      target("t102", "LUM-102", "Prorated refunds on plan downgrade", "billing", "feature", 2, 6, 3, ["brightpath-clinics"]),
      target("t103", "LUM-103", "Invoice PDF shows the wrong currency symbol for CAD", "billing", "bug", 1, 4, 6, ["kestrel-labs"]),
      target("t104", "LUM-104", "SSO users are logged out every 10 minutes", "auth", "bug", 3, 17, 3, ["northwind-freight"]),
      target("t105", "LUM-105", "Passkey login", "auth", "feature", 1, 20, 5, ["kestrel-labs"]),
      target("t106", "LUM-106", "Invite emails arrive after the trial clock starts", "onboarding", "bug", 2, 3, 12, ["acme-robotics", "orchard-education"]),
      target("t107", "LUM-107", "Bulk invite teammates from a CSV", "onboarding", "feature", 2, 5, 15, ["brightpath-clinics"]),
      target("t108", "LUM-108", "Search shows archived projects from other workspaces", "search", "bug", 3, 18, 12, ["northwind-freight"]),
      target("t109", "LUM-109", "Typo-tolerant search", "search", "feature", 1, 20, 15, ["orchard-education"]),
    ],
    teams: [
      { id: 1, name: "Red", color: "#d64545", autopilot: false, members: ["u1", "u2", "u3"], workflow: null },
      { id: 2, name: "Blue", color: "#3b7dd8", autopilot: false, members: ["u4", "u5"], workflow: null },
    ],
    orders: [],
    unitTypes: builtinUnitTypes(),
    workflowRuns: [],
    memory: { pages: 0, recent: [] },
    stats: { spentUsd: 0, tokens: 0 },
    backend: "mock",
  };
}
