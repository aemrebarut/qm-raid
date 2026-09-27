// Synthetic demo state used when the engine is down (and by tests). Matches contract/types.ts.
// All names, companies and issues are invented.
import type { State } from "./types";

const t0 = 1790546400000; // 2026-09-27 15:00 PDT, epoch ms

export function fixtureState(): State {
  return {
    components: [
      { id: "billing", name: "Billing", zone: { x: 1, y: 1, w: 7, h: 6 } },
      { id: "auth", name: "Auth", zone: { x: 9, y: 1, w: 6, h: 5 } },
      { id: "search", name: "Search", zone: { x: 16, y: 1, w: 7, h: 6 } },
      { id: "notifications", name: "Notifications", zone: { x: 1, y: 9, w: 6, h: 6 } },
      { id: "api", name: "Public API", zone: { x: 17, y: 9, w: 6, h: 6 } },
      { id: "dashboard", name: "Dashboard", zone: { x: 8, y: 16, w: 8, h: 6 } },
    ],
    buildings: [
      { id: "library", kind: "gbrain", x: 11, y: 11 },
      { id: "barracks", kind: "barracks", x: 20, y: 20 },
      { id: "forge", kind: "river", x: 3, y: 20 },
    ],
    units: [
      { id: "u1", name: "Ada", class: "knight", model: "gpt-6-astra", effort: "high", role: "worker", team: 1, status: "working", pos: { x: 5, y: 4 }, orderId: "o1", qm: { sessionId: "s-ada", sessionUrl: null } },
      { id: "u2", name: "Brom", class: "knight", model: "gpt-6-astra", effort: "high", role: "worker", team: 1, status: "idle", pos: { x: 13, y: 14 }, orderId: null, qm: { sessionId: null, sessionUrl: null } },
      { id: "u3", name: "Cyra", class: "ranger", model: "gpt-6-sol", effort: "medium", role: "worker", team: 1, status: "recalling", pos: { x: 12, y: 13 }, orderId: null, qm: { sessionId: null, sessionUrl: null } },
      { id: "u4", name: "Dain", class: "ranger", model: "gpt-6-sol", effort: "medium", role: "worker", team: 2, status: "moving", pos: { x: 16, y: 12 }, orderId: "o2", qm: { sessionId: null, sessionUrl: null } },
      { id: "u5", name: "Esme", class: "scout", model: "gpt-6-luna", effort: "low", role: "worker", team: 2, status: "idle", pos: { x: 19, y: 18 }, orderId: null, qm: { sessionId: null, sessionUrl: null } },
      { id: "u6", name: "Fenn", class: "scout", model: "gpt-6-luna", effort: "low", role: "worker", team: null, status: "idle", pos: { x: 21, y: 18 }, orderId: null, qm: { sessionId: null, sessionUrl: null } },
    ],
    targets: [
      { id: "t12", issue: "LUM-12", title: "Retry double-charges a card", component: "billing", kind: "bug", severity: 3, status: "engaged", pos: { x: 4, y: 3 }, customers: ["acme-robotics"] },
      { id: "t13", issue: "LUM-13", title: "Invoice PDF shows wrong currency", component: "billing", kind: "bug", severity: 2, status: "open", pos: { x: 6, y: 5 }, customers: ["brightline-foods"] },
      { id: "t21", issue: "LUM-21", title: "Magic link expires too early", component: "auth", kind: "bug", severity: 2, status: "open", pos: { x: 11, y: 3 }, customers: ["acme-robotics", "tidewater-labs"] },
      { id: "t22", issue: "LUM-22", title: "Add passkey sign in", component: "auth", kind: "feature", severity: 1, status: "open", pos: { x: 13, y: 2 }, customers: [] },
      { id: "t31", issue: "LUM-31", title: "Search ignores accents", component: "search", kind: "bug", severity: 1, status: "open", pos: { x: 18, y: 3 }, customers: ["tidewater-labs"] },
      { id: "t41", issue: "LUM-41", title: "Digest emails sent twice", component: "notifications", kind: "bug", severity: 2, status: "open", pos: { x: 3, y: 11 }, customers: ["brightline-foods"] },
      { id: "t51", issue: "LUM-51", title: "Rate limit headers missing", component: "api", kind: "bug", severity: 3, status: "engaged", pos: { x: 20, y: 11 }, customers: ["northwind-drones"] },
      { id: "t61", issue: "LUM-61", title: "Dark mode for charts", component: "dashboard", kind: "feature", severity: 1, status: "resolved", pos: { x: 11, y: 19 }, customers: [] },
    ],
    teams: [
      { id: 1, name: "Red", color: "#d64545", autopilot: false, members: ["u1", "u2", "u3"] },
      { id: 2, name: "Blue", color: "#3f7fd6", autopilot: true, members: ["u4", "u5"] },
    ],
    orders: [
      { id: "o1", unitId: "u1", targetId: "t12", status: "active", source: "user", vetoDeadline: null, reply: null },
      { id: "o2", unitId: "u4", targetId: "t51", status: "active", source: "autopilot", vetoDeadline: null, reply: null },
      { id: "o3", unitId: "u5", targetId: "t31", status: "proposed", source: "autopilot", vetoDeadline: Date.now() + 15000, reply: null },
    ],
    unitTypes: [
      { id: "knight", name: "Knight", source: "builtin", status: "ready", progress: 1, stage: "ready", model: "gpt-6-astra" },
      { id: "ranger", name: "Ranger", source: "builtin", status: "ready", progress: 1, stage: "ready", model: "gpt-6-sol" },
      { id: "scout", name: "Scout", source: "builtin", status: "ready", progress: 1, stage: "ready", model: "gpt-6-luna" },
      { id: "forge-triager", name: "Triager", source: "forge", status: "training", progress: 0.45, stage: "SFT epoch 1 of 2", model: null },
    ],
    memory: {
      pages: 42,
      recent: [
        { ts: t0 - 60000, unitId: "u1", op: "recall", slugs: ["components/billing", "issues/lum-12"], summary: "Billing retries go through the idempotency middleware" },
        { ts: t0 - 30000, unitId: "u3", op: "remember", slugs: ["learnings/lum-7-u3-1790546370000"], summary: "Always pass an idempotency key to the charge call" },
      ],
    },
    stats: { spentUsd: 0.42, tokens: 18250 },
    backend: "fixture",
  };
}
