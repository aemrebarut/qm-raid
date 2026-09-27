// Prints and exports the effective VO placement of the current cut (for raid-video-rev's sync check).
// Usage: bun scripts/vo-plan.ts [out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { placeVo } from "../src/main/voPlace";

const m = JSON.parse(readFileSync(join(import.meta.dir, "../audio/manifest.json"), "utf8"));
const placed = placeVo(m.tracks ?? [], m.alts ?? []);
let prevEnd = -1;
let bad = 0;
for (const p of placed) {
  const end = p.abs + p.t.duration;
  const ov = p.abs < prevEnd ? `  OVERLAP ${(prevEnd - p.abs).toFixed(3)}s` : "";
  if (ov) bad++;
  console.log(`${p.abs.toFixed(3)}-${end.toFixed(3)}  ${p.section.padEnd(8)} +${p.at.toFixed(2)} ${p.how.padEnd(8)} ${p.t.file}${ov}`);
  prevEnd = Math.max(prevEnd, end);
}
const out = process.argv[2];
if (out) writeFileSync(out, JSON.stringify(placed.map((p) => ({ file: p.t.file, section: p.section, start: +p.abs.toFixed(3), end: +(p.abs + p.t.duration).toFixed(3), how: p.how })), null, 2));
console.log(bad ? `${bad} overlaps` : "no overlaps");
process.exit(bad ? 1 : 0);
