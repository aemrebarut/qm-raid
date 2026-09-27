// World (raid-art-world): the three buildings with their effects, terrain, zones and props.
import * as THREE from "three";
import type { Exhibit } from "../../src/types";
import { makeBuilding, type BuildingKind } from "../../src/world/buildings";
import { makeTerrain } from "../../src/world/terrain";
import { makeZones } from "../../src/world/zones";
import type { ZoneSpec } from "../../src/types";

function building(kind: BuildingKind, title: string): Exhibit {
  return {
    name: `Building: ${title}`,
    area: "world",
    span: 3.5,
    make() {
      const b = makeBuilding(kind);
      let work = 0, working = false;
      return {
        object3d: b.object3d,
        tick(t, dt) {
          if (working) { work = (work + dt * 0.1) % 1; b.setWork(work); }
          b.tick(t, dt);
        },
        actions: {
          pulse: () => b.pulse(),
          "glow on": () => b.glow(true),
          "glow off": () => b.glow(false),
          ...(kind === "forge" ? { "work on": () => { working = true; }, "work off": () => { working = false; b.setWork(null); } } : {}),
        },
        dispose: () => b.dispose(),
      };
    },
  };
}

// Board-like layout: four districts, Library in the middle, roads from each gate and building.
const ZONES = [{ x: 2, y: 2, w: 7, h: 6 }, { x: 14, y: 2, w: 8, h: 6 }, { x: 2, y: 15, w: 7, h: 7 }, { x: 14, y: 14, w: 8, h: 8 }];
const COLORS = ["#b8433a", "#3f73b8", "#c9a227", "#7b4fa3"];
const LIB: [number, number] = [11, 11];
/** Gate on the side facing the Library (same rule as the board's zoneGate). */
function gateOf(z: { x: number; y: number; w: number; h: number }): NonNullable<ZoneSpec["gate"]> {
  const cx = z.x + z.w / 2, cy = z.y + z.h / 2, dx = LIB[0] + 0.5 - cx, dy = LIB[1] + 0.5 - cy;
  const clampY = (v: number) => Math.max(z.y + 1, Math.min(z.y + z.h - 2, Math.round(v)));
  const clampX = (v: number) => Math.max(z.x + 1, Math.min(z.x + z.w - 2, Math.round(v)));
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? { side: "e", x: z.x + z.w, y: clampY(cy - 0.5) } : { side: "w", x: z.x - 1, y: clampY(cy - 0.5) };
  return dy > 0 ? { side: "s", x: clampX(cx - 0.5), y: z.y + z.h } : { side: "n", x: clampX(cx - 0.5), y: z.y - 1 };
}
const terrain: Exhibit = {
  name: "Map: terrain and zones (24 x 24)",
  area: "world",
  span: 34,
  turntable: false,
  make() {
    const blocked: [number, number][] = [];
    for (const z of ZONES) for (let i = z.x - 1; i <= z.x + z.w; i++) for (let j = z.y - 1; j <= z.y + z.h; j++) blocked.push([i, j]);
    for (const [bx, by] of [LIB, [5, 11], [18, 11]]) for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) blocked.push([bx + i, by + j]);
    const paths: [number, number][][] = [
      ...ZONES.map((z): [number, number][] => { const g = gateOf(z); const ew = g.side === "e" || g.side === "w"; return [[g.x, g.y], ew ? [LIB[0], g.y] : [g.x, LIB[1]], LIB]; }),
      [[5, 11], LIB], [[18, 11], LIB],
    ];
    const t = makeTerrain({ size: 24, seed: 3, paths, blocked }, { margin: 5 });
    const camps: [number, number][] = ZONES.map((z) => [Math.floor(z.x + z.w / 2), Math.floor(z.y + z.h / 2)]);
    const zs = makeZones(ZONES.map((z, i) => ({ ...z, color: COLORS[i], gate: gateOf(z) })), { blocked: camps });
    const wrap = new THREE.Group(); // terrain is in world coords 0..24; centre it on the cell
    t.object3d.position.set(-12, 0.012, -12); // just above the showroom plate (no z-fighting)
    zs.object3d.position.set(-12, 0.012, -12);
    wrap.add(t.object3d, zs.object3d);
    return { object3d: wrap, tick: (tt, dt) => { t.tick(tt, dt); zs.tick(tt, dt); }, dispose: () => { t.dispose(); zs.dispose(); } };
  },
};

const exhibits: Exhibit[] = [
  terrain,
  building("library", "Library (GBrain)"),
  building("barracks", "Barracks"),
  building("forge", "Forge (River)"),
];
export default exhibits;
