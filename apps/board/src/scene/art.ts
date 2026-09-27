// Art swap flag: packages/art factories replace placeholder bodies per area. OFF by default so the 4611 demo cannot
// change under us. localStorage 'raid.art' (or ?art= in the URL, which wins): unset or 'off' = placeholders,
// 'on' = every area, or a comma list of areas (units,targets,buildings,terrain,zones,props,lighting,fx).
// Read once per page load.
export type ArtArea = "units" | "targets" | "buildings" | "terrain" | "zones" | "props" | "lighting" | "fx";

let areas: Set<string> | null = null;
function load() {
  let v: string | null = null;
  try { v = new URLSearchParams(location.search).get("art") ?? localStorage.getItem("raid.art"); } catch {}
  v = (v ?? "").trim();
  if (!v || v === "off") return new Set<string>();
  if (v === "on") return new Set(["units", "targets", "buildings", "terrain", "zones", "props", "lighting", "fx"]);
  return new Set(v.split(",").map((s) => s.trim()));
}

export function artOn(area: ArtArea) {
  areas ??= load();
  return areas.has(area);
}
