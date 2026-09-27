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

// Autopilot veto log, read by raid-river (repo data/vetoes.jsonl, gitignored).
export const VETO_LOG = process.env.VETO_LOG ?? new URL("../../../data/vetoes.jsonl", import.meta.url).pathname;
export const AUTOPILOT_EVERY_MS = 3000;
export const VETO_WINDOW_MS = 15000;

export const TILES_PER_SEC = 3;
export const GRID = 24;
export const MEMORY_RECENT_MAX = 20;
// How long a unit shows recalling / remembering after a gbrain tool call before going back to working.
export const MEMORY_ANIM_MS = 1500;
