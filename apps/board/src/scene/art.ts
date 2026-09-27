// Art swap flag: packages/art factories replace placeholder bodies per area. ON by default since A3 passed art and UI
// review and the Look shot set (16:00). localStorage 'raid.art' (or ?art= in the URL, which wins): unset or 'on' =
// every area, 'off' = placeholders (the instant fallback), or a comma list of areas
// (units,targets,buildings,terrain,zones,props,lighting,fx). Read once per page load.
export type ArtArea = "units" | "targets" | "buildings" | "terrain" | "zones" | "props" | "lighting" | "fx";

const ALL: ArtArea[] = ["units", "targets", "buildings", "terrain", "zones", "props", "lighting", "fx"];

let areas: Set<string> | null = null;
function load() {
  let v: string | null = null;
  try { v = new URLSearchParams(location.search).get("art") ?? localStorage.getItem("raid.art"); } catch {}
  v = (v ?? "").trim();
  if (v === "off") return new Set<string>();
  if (!v || v === "on") return new Set<string>(ALL);
  return new Set(v.split(",").map((s) => s.trim()));
}

export function artOn(area: ArtArea) {
  areas ??= load();
  return areas.has(area);
}
