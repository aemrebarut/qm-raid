// Loadout (docs/CONTRACT.md "Loadout"): a unit's standing orders, QM skills and plugins (MCP servers), applied without
// QM core changes: a visible "Loadout changed" marker turn in the unit's stable conversation, and every order header
// restates the standing orders, so they hold even though QM keeps its own session prompt.
import type { CatalogItem, Loadout } from "../../../contract/types.ts";
import { PORTAL_URL } from "./qm.ts";

export const GBRAIN = "gbrain"; // always on: the bridge's agents use it for recall and remember
const MAX_INSTRUCTIONS = 4000; // stored
const HEADER_INSTRUCTIONS = 800; // restated in every order header

const FALLBACK: CatalogItem[] = [
  { id: "raid-board", name: "raid-board", description: "Work as a unit on the QM Raid board.", kind: "skill" },
  { id: GBRAIN, name: "GBrain", description: "Shared game brain: recall house rules and past learnings, remember what you learn.", kind: "plugin" },
];

const ids = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()))] : [];

/** Clean a loadout from a request; null when the value is not an object. */
export function normalizeLoadout(v: unknown): Loadout | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    instructions: typeof o.instructions === "string" ? o.instructions.trim().slice(0, MAX_INSTRUCTIONS) : "",
    skills: ids(o.skills),
    plugins: ids(o.plugins),
  };
}

export function sameLoadout(a: Loadout | undefined | null, b: Loadout | undefined | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const pluginsText = (l: Loadout): string => [...new Set([...l.plugins, GBRAIN])].join(", ");

/** The visible marker turn queued in the unit's conversation when its loadout changes. */
export function loadoutMarker(l: Loadout): string {
  return (
    `Loadout changed. Standing orders from now on: ${l.instructions || "(none)"}. ` +
    `Skills: ${l.skills.length ? l.skills.join(", ") : "(none)"}, load them with the skills tool when relevant. ` +
    `Plugins: use only ${pluginsText(l)} (GBrain always on). Reply with one short line.`
  );
}

/** Lines restated after every order's header line. */
export function loadoutLines(l: Loadout | undefined): string[] {
  if (!l) return [];
  const lines: string[] = [];
  if (l.instructions) {
    const s = l.instructions.length > HEADER_INSTRUCTIONS ? `${l.instructions.slice(0, HEADER_INSTRUCTIONS)}...` : l.instructions;
    lines.push(`Standing orders: ${s}`);
  }
  if (l.skills.length || l.plugins.length) lines.push(`Loadout: skills ${l.skills.join(",") || "-"} | plugins ${pluginsText(l)}`);
  return lines;
}

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${PORTAL_URL}${path}`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

/** Skills from the portal (published, not shadowed; id = skill name, which the QM skills tool loads by) and MCP
 *  servers when QM lists them (it has no HTTP list today), GBrain always included. Fixed fallback when QM is down. */
export async function fetchCatalog(): Promise<CatalogItem[]> {
  let skills: CatalogItem[];
  try {
    const d = await getJson("/api/skills");
    skills = (Array.isArray(d?.skills) ? d.skills : [])
      .filter((s: any) => typeof s?.name === "string" && !s.shadowed && (s.status ?? "published") === "published")
      .map((s: any): CatalogItem => ({ id: s.name, name: s.name, description: String(s.description ?? "").split(/(?<=\.)\s/)[0].slice(0, 160), kind: "skill" }));
  } catch {
    return FALLBACK;
  }
  const plugins: CatalogItem[] = [];
  try {
    const d = await getJson("/admin/api/mcp-servers");
    for (const s of Array.isArray(d) ? d : (d?.servers ?? d?.items ?? [])) {
      if (typeof s?.id !== "string" || s.enabled === false) continue;
      plugins.push({ id: s.id, name: String(s.name ?? s.id), description: String(s.description ?? "MCP server").slice(0, 160), kind: "plugin" });
    }
  } catch {
    // no MCP list route on this QM: GBrain only
  }
  if (!plugins.some((p) => p.id === GBRAIN)) plugins.unshift(FALLBACK[1]!);
  // Board skill first, then alphabetical.
  skills.sort((a, b) => (a.id === "raid-board" ? -1 : b.id === "raid-board" ? 1 : a.id.localeCompare(b.id)));
  return [...skills, ...plugins];
}
