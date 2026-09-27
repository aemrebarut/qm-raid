// All engine settings in one place. Env vars override defaults.
export const HOST = "127.0.0.1";
export const PORT = Number(process.env.PORT ?? 4610);
export const BRIDGE_URL = (process.env.BRIDGE_URL ?? "http://127.0.0.1:4615").replace(/\/$/, "");
export const BRAIN_URL = (process.env.BRAIN_URL ?? "http://127.0.0.1:4616").replace(/\/$/, "");
export const PROPOSER_URL = (process.env.PROPOSER_URL ?? "http://127.0.0.1:4613").replace(/\/$/, "");
export const FORGE_URL = (process.env.FORGE_URL ?? "http://127.0.0.1:4612").replace(/\/$/, "");

// Built-in unit classes and the model each one runs (Barracks spawn uses this).
export const CLASS_MODELS: Record<string, { name: string; model: string; effort: string }> = {
  knight: { name: "Knight", model: "claude-opus-5-5", effort: "high" },
  ranger: { name: "Ranger", model: "claude-sonnet-5", effort: "medium" },
  scout: { name: "Scout", model: "claude-haiku-4-5-20251001", effort: "low" },
};

export const TILES_PER_SEC = 3;
export const GRID = 24;
export const MEMORY_RECENT_MAX = 20;
// How long a unit shows recalling / remembering after a gbrain tool call before going back to working.
export const MEMORY_ANIM_MS = 1500;
