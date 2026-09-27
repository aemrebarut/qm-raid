// All engine settings in one place. Env vars override defaults.
export const HOST = "127.0.0.1";
export const PORT = Number(process.env.PORT ?? 4610);
export const BRIDGE_URL = (process.env.BRIDGE_URL ?? "http://127.0.0.1:4615").replace(/\/$/, "");
export const BRAIN_URL = (process.env.BRAIN_URL ?? "http://127.0.0.1:4616").replace(/\/$/, "");
export const PROPOSER_URL = (process.env.PROPOSER_URL ?? "http://127.0.0.1:4613").replace(/\/$/, "");
export const FORGE_URL = (process.env.FORGE_URL ?? "http://127.0.0.1:4612").replace(/\/$/, "");

// Built-in unit classes and the model each one runs (Barracks spawn uses this). QM runs HARNESS=codex.
export const CLASS_MODELS: Record<string, { name: string; model: string; effort: string }> = {
  knight: { name: "Knight", model: "gpt-6-astra", effort: "high" },
  ranger: { name: "Ranger", model: "gpt-6-sol", effort: "medium" },
  scout: { name: "Scout", model: "gpt-6-luna", effort: "low" },
};

// POST /api/reset also resets the shared game brain unless BRAIN_RESET=0 (test instances must never wipe it).
export const BRAIN_RESET = process.env.BRAIN_RESET !== "0";

// Autopilot veto log, read by raid-river (repo data/vetoes.jsonl, gitignored).
export const VETO_LOG = process.env.VETO_LOG ?? new URL("../../../data/vetoes.jsonl", import.meta.url).pathname;
export const AUTOPILOT_EVERY_MS = 3000;
export const VETO_WINDOW_MS = 15000;

// SSE: a client with more unread events than this is dropped (it reconnects and gets a fresh snapshot).
export const SSE_MAX_QUEUE = 2000;

// Browser origins allowed to call the engine (the board on 4611, the test board on 4619, the frozen demo board on 4621);
// CORS_ORIGINS (comma-separated) adds more.
export const CORS_ORIGINS = ["http://127.0.0.1:4611", "http://localhost:4611", "http://127.0.0.1:4619", "http://localhost:4619",
  "http://127.0.0.1:4621", "http://localhost:4621",
  ...(process.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean)];

// Team workflows: default role instructions (CONTRACT.md "Team workflows"); a node's own instructions override.
export const ROLE_INSTRUCTIONS: Record<string, string> = {
  planner: "Recall first. Write a short numbered plan for the implementer; do not implement.",
  implementer: "Recall first. Implement the plan or apply the review changes; remember what you learned.",
  reviewer: "Recall the house rules. Review the implementation against the plan and the rules. End with VERDICT: APPROVED or VERDICT: CHANGES: <what>.",
};

export const TILES_PER_SEC = 3;
export const GRID = 24;
export const MEMORY_RECENT_MAX = 20;
// How long a unit shows recalling / remembering after a gbrain tool call before going back to working.
export const MEMORY_ANIM_MS = 1500;
