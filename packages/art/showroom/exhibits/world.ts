// World (raid-art-world): the three buildings with their effects, terrain, zones and props.
import * as THREE from "three";
import type { Exhibit } from "../../src/types";
import { makeBuilding, type BuildingKind } from "../../src/world/buildings";
import { makeTerrain } from "../../src/world/terrain";

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
const LIB: [number, number] = [11, 11];
const terrain: Exhibit = {
  name: "Terrain: 24 x 24 map, roads, river, forest",
  area: "world",
  span: 34,
  turntable: false,
  make() {
    const blocked: [number, number][] = [];
    for (const z of ZONES) for (let i = z.x - 1; i <= z.x + z.w; i++) for (let j = z.y - 1; j <= z.y + z.h; j++) blocked.push([i, j]);
    for (const [bx, by] of [LIB, [5, 11], [18, 11]]) for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) blocked.push([bx + i, by + j]);
    const paths: [number, number][][] = [
      [[9, 5], [11, 5], LIB], [[13, 5], [11, 5]], [[9, 18], [11, 18], LIB], [[13, 18], [11, 18]], [[5, 11], LIB], [[18, 11], LIB],
    ];
    const t = makeTerrain({ size: 24, seed: 3, paths, blocked }, { margin: 5 });
    const wrap = new THREE.Group(); // terrain is in world coords 0..24; centre it on the cell
    t.object3d.position.set(-12, 0.012, -12); // just above the showroom plate (no z-fighting)
    wrap.add(t.object3d);
    return { object3d: wrap, tick: (tt, dt) => t.tick(tt, dt), dispose: () => t.dispose() };
  },
};

const exhibits: Exhibit[] = [
  terrain,
  building("library", "Library (GBrain)"),
  building("barracks", "Barracks"),
  building("forge", "Forge (River)"),
];
export default exhibits;
