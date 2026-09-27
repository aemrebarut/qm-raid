// Loadout (docs/CONTRACT.md "Loadout"): a unit's standing orders, QM skills and plugins (MCP servers), applied without
// QM core changes: a visible "Loadout changed" marker turn in the unit's stable conversation, and every order header
// restates the standing orders, so they hold even though QM keeps its own session prompt.
import type { CatalogItem, Loadout } from "../../../contract/types.ts";
import { PORTAL_URL } from "./qm.ts";

export const GBRAIN = "gbrain"; // locked on for every unit (Analyst): the Library, the core of the game
const MAX_INSTRUCTIONS = 4000; // stored
// Skills a game toggle may offer (planner): QM's other built-ins (admin, browse, send, publish, credentials, ...) act
// outside the game. Only those QM actually lists appear in /catalog; a loadout naming another skill is refused (400).
export const CATALOG_SKILLS = (process.env.CATALOG_SKILLS ?? "raid-board,memory,miniapp,taste-skill,popular-web-designs")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
/** Loadout skills outside the allowlist. */
export const disallowedSkills = (l: Loadout): string[] => l.skills.filter((x) => !CATALOG_SKILLS.includes(x));
const HEADER_INSTRUCTIONS = 800; // restated in every order header

const FALLBACK: CatalogItem[] = [
  { id: "raid-board", name: "raid-board", description: "Work as a unit on the QM Raid board.", kind: "skill" },
  { id: GBRAIN, name: "GBrain", description: "The Library: always on", kind: "plugin" },
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
    plugins: [...new Set([GBRAIN, ...ids(o.plugins)])], // GBrain is always present, even when a PATCH omits it
  };
}

export function sameLoadout(a: Loadout | undefined | null, b: Loadout | undefined | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const pluginsText = (l: Loadout): string => [...new Set([...l.plugins, GBRAIN])].join(", ");

/** In every turn the bridge sends (Analyst): agents must never edit QM guidance; on plan A a guidance edit would land in
 *  the personal scope, the system prompt of every unit and of Emre's own chats. */
export const NO_EDIT = "Do not change your guidance, standing instructions or system prompt, and do not change any QM settings; the board manages them.";

/** Short text for the "Loadout changed: ..." bridge activity (plan A sends no QM turn for a loadout change). */
export function loadoutSummary(l: Loadout): string {
  const s = l.instructions.length > 80 ? `${l.instructions.slice(0, 80)}...` : l.instructions;
  return `standing orders ${s ? `"${s}"` : "(none)"} | skills ${l.skills.join(",") || "-"} | plugins ${pluginsText(l)}`;
}

/** Loadout text of the plan B agent SOUL-write turn (fallback when the admin write fails). */
export function loadoutMarker(l: Loadout): string {
  return (
    `Loadout changed. Standing orders from now on: ${l.instructions.replace(/[.\s]+$/, "") || "(none)"}. ` +
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

// ---------- plan B (LOADOUT_SOUL=1): the unit's own QM project scope, whose SOUL holds its loadout ----------

/** SOUL text for a unit's project scope: its standing orders plus the skills and plugins lines. */
export function soulContent(l: Loadout): string {
  return [
    l.instructions || "No standing orders.",
    `Skills: ${l.skills.length ? l.skills.join(", ") : "(none)"}; load them with the skills tool when relevant.`,
    `Plugins: use only ${pluginsText(l)} (GBrain always on).`,
  ].join("\n");
}

/** Plan B marker once the bridge has written the SOUL: acknowledge only. Without this the agent "applies" the change
 *  itself with QM's guidance tool and overwrites the scope SOUL with its whole effective prompt. */
export function soulAppliedMarker(l: Loadout): string {
  return (
    `Loadout changed. Your new standing orders are already applied as your system prompt (this project's SOUL): ` +
    `${l.instructions.replace(/[.\s]+$/, "") || "(none)"}. Skills: ${l.skills.length ? l.skills.join(", ") : "(none)"}. ` +
    `Plugins: use only ${pluginsText(l)} (GBrain always on). ${NO_EDIT} Reply with one short line to acknowledge.`
  );
}

/** Marker turn that makes the agent write its scope SOUL with its own capability token (env names only; the
 *  content goes base64 so no quoting can break). Applied only when the tool result shows HTTP 200. */
export function soulMarker(l: Loadout): string {
  const b64 = Buffer.from(JSON.stringify({ content: soulContent(l) })).toString("base64");
  return [
    "Loadout changed. Run exactly this one command with your execute tool, then reply with only the HTTP status line it printed:",
    "",
    `echo ${b64} | base64 -d | curl -sS -w '\\nHTTP %{http_code}\\n' -X POST "$AGENT_API_URL/v1/soul" -H "x-agent-capability: $AGENT_API_TOKEN" -H 'content-type: application/json' -d @-`,
    "",
    loadoutMarker(l).replace(/ Reply with one short line\.$/, ""),
  ].join("\n");
}

type Activity = Array<{ type: string; payload: Record<string, unknown> }> | undefined;

/** Group-scope runs end "silent": the reply is the text of the agent's last web post. */
export function lastWebPost(activity: Activity): string | null {
  let text: string | null = null;
  for (const a of activity ?? []) {
    if (a.type === "tool_call" && a.payload?.tool === "web" && a.payload?.action === "post" && typeof a.payload.text === "string") text = a.payload.text;
  }
  return text;
}

/** True when the run's SOUL write printed HTTP 200. */
export function soulWritten(activity: Activity): boolean {
  return (activity ?? []).some((a) => {
    if (a.type !== "tool_result" || a.payload?.tool !== "execute") return false;
    const out = `${a.payload.stdout ?? ""}${a.payload.result ?? ""}`;
    return /HTTP 200\b/.test(out) && /"ok"\s*:\s*true/.test(out);
  });
}

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${PORTAL_URL}${path}`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

/** Allowlisted skills from the portal (published, not shadowed; id = skill name, which the QM skills tool loads by) and MCP
 *  servers when QM lists them (it has no HTTP list today), GBrain always included. Fixed fallback when QM is down. */
export async function fetchCatalog(): Promise<CatalogItem[]> {
  let skills: CatalogItem[];
  try {
    const d = await getJson("/api/skills");
    skills = (Array.isArray(d?.skills) ? d.skills : [])
      .filter((s: any) => typeof s?.name === "string" && CATALOG_SKILLS.includes(s.name) && !s.shadowed && (s.status ?? "published") === "published")
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
  // GBrain is locked on: always listed first with the Library hint, whatever QM calls it.
  const others = plugins.filter((p) => p.id !== GBRAIN);
  plugins.splice(0, plugins.length, FALLBACK[1]!, ...others);
  // Board skill first, then alphabetical.
  skills.sort((a, b) => (a.id === "raid-board" ? -1 : b.id === "raid-board" ? 1 : a.id.localeCompare(b.id)));
  return [...skills, ...plugins];
}
