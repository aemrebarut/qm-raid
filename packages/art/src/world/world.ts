// makeWorld: terrain + zones + farms from a plain board layout in one call, so the board swaps its ground,
// walls and scatter with a few lines. Roads run from each zone gate and each building to the Library
// (L-shaped, like the board's own path tiles). World coordinates. No board imports.
import * as THREE from "three";
import type { Handle, ZoneSpec } from "../types";
import { makeProps, type PropsArt } from "./props";
import { makeTerrain, type TerrainArt } from "./terrain";
import { makeZones, type ZonesArt } from "./zones";

export interface WorldSpec {
  size: number;
  seed?: number;
  /** Library tile (roads meet here). */
  library: { x: number; y: number };
  /** Other buildings (3 x 3, centred on the tile); each gets a road to the Library. */
  buildings?: { x: number; y: number }[];
  /** Zones with their gate (the wall gap facing the Library). */
  zones: ZoneSpec[];
  /** Extra tiles to keep clear of anything tall and of props: camps, unit staging, spawn points. */
  blocked?: [number, number][];
  /** Land drawn beyond the map edge (default 16; the showroom uses less). */
  margin?: number;
}
export interface WorldArt extends Handle {
  terrain: TerrainArt;
  zones: ZonesArt;
  props: PropsArt;
  tick(t: number, dt: number): void;
  heightAt(x: number, z: number): number;
}

export function makeWorld(spec: WorldSpec): WorldArt {
  const lib = spec.library, seed = spec.seed ?? 7;
  const paths: [number, number][][] = [];
  for (const z of spec.zones) {
    if (!z.gate) continue;
    const xFirst = z.gate.side === "e" || z.gate.side === "w";
    paths.push([[z.gate.x, z.gate.y], xFirst ? [lib.x, z.gate.y] : [z.gate.x, lib.y], [lib.x, lib.y]]);
  }
  for (const b of spec.buildings ?? []) paths.push([[b.x, b.y], [b.x, lib.y], [lib.x, lib.y]]);

  const blocked: [number, number][] = [...(spec.blocked ?? [])];
  for (const z of spec.zones) for (let i = z.x - 1; i <= z.x + z.w; i++) for (let j = z.y - 1; j <= z.y + z.h; j++) blocked.push([i, j]);
  for (const b of [lib, ...(spec.buildings ?? [])]) for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) blocked.push([b.x + i, b.y + j]);

  const terrain = makeTerrain({ size: spec.size, seed, paths, blocked }, { margin: spec.margin });
  const zones = makeZones(spec.zones, { seed, blocked: spec.blocked });
  const props = makeProps({ seed, spots: [] }, { size: spec.size, blocked, paths });
  const group = new THREE.Group();
  group.name = "art:world";
  group.add(terrain.object3d, zones.object3d, props.object3d);
  return {
    object3d: group, terrain, zones, props,
    heightAt: terrain.heightAt,
    tick(t, dt) { terrain.tick(t, dt); zones.tick(t, dt); props.tick(t, dt); },
    dispose() { terrain.dispose(); zones.dispose(); props.dispose(); },
  };
}
