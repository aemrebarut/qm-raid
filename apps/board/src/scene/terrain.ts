// Grass terrain with dirt paths, trees and rocks. Rebuilt only when the world layout changes.
import * as THREE from "three";
import type { Building, Component, Target } from "../core";
import { MAP_SIZE } from "./camera";
import { hash, mat, rng } from "./util";

export const FOOTPRINT = 1; // buildings cover x-1..x+1, y-1..y+1

type Key = string;
const k = (x: number, y: number): Key => `${x},${y}`;

export interface Gate { side: "n" | "s" | "e" | "w"; x: number; y: number } // outside tile in front of the gap

/** Gate of a zone: the wall gap on the side facing the Library. */
export function zoneGate(c: Component, lib: { x: number; y: number }): Gate {
  const { x, y, w, h } = c.zone;
  const cx = x + w / 2, cy = y + h / 2;
  const dx = lib.x + 0.5 - cx, dy = lib.y + 0.5 - cy;
  const clampY = (v: number) => Math.max(y + 1, Math.min(y + h - 2, Math.round(v)));
  const clampX = (v: number) => Math.max(x + 1, Math.min(x + w - 2, Math.round(v)));
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? { side: "e", x: x + w, y: clampY(cy - 0.5) } : { side: "w", x: x - 1, y: clampY(cy - 0.5) };
  }
  return dy > 0 ? { side: "s", x: clampX(cx - 0.5), y: y + h } : { side: "n", x: clampX(cx - 0.5), y: y - 1 };
}

function libraryOf(buildings: Building[]) {
  const b = buildings.find((b) => b.kind === "gbrain");
  return b ? { x: b.x, y: b.y } : { x: 11, y: 11 };
}

function pathTiles(components: Component[], buildings: Building[]) {
  const lib = libraryOf(buildings);
  const tiles = new Set<Key>();
  const walk = (x0: number, y0: number, xFirst: boolean) => {
    let x = x0, y = y0;
    const stepX = () => { while (x !== lib.x) { tiles.add(k(x, y)); x += Math.sign(lib.x - x); } };
    const stepY = () => { while (y !== lib.y) { tiles.add(k(x, y)); y += Math.sign(lib.y - y); } };
    if (xFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
    tiles.add(k(x, y));
  };
  for (const c of components) {
    const g = zoneGate(c, lib);
    walk(g.x, g.y, g.side === "e" || g.side === "w");
  }
  for (const b of buildings) if (b.kind !== "gbrain") walk(b.x, b.y, false);
  return tiles;
}

function blockedTiles(components: Component[], buildings: Building[], targets: Target[]) {
  const s = new Set<Key>();
  for (const c of components) {
    const { x, y, w, h } = c.zone;
    for (let i = x - 1; i <= x + w; i++) for (let j = y - 1; j <= y + h; j++) s.add(k(i, j));
  }
  for (const b of buildings) {
    for (let i = b.x - FOOTPRINT - 1; i <= b.x + FOOTPRINT + 1; i++)
      for (let j = b.y - FOOTPRINT - 1; j <= b.y + FOOTPRINT + 1; j++) s.add(k(i, j));
  }
  for (const t of targets) s.add(k(t.pos.x, t.pos.y));
  // Clear plaza around the Library: idle units stage there.
  const lib = buildings.find((b) => b.kind === "gbrain");
  if (lib) for (let i = lib.x - 4; i <= lib.x + 4; i++) for (let j = lib.y - 4; j <= lib.y + 4; j++) s.add(k(i, j));
  return s;
}

export function layoutKey(components: Component[], buildings: Building[]) {
  return JSON.stringify([components.map((c) => [c.id, c.zone]), buildings.map((b) => [b.id, b.x, b.y])]);
}

export function buildTerrain(components: Component[], buildings: Building[], targets: Target[]) {
  const group = new THREE.Group();
  group.name = "terrain";
  const paths = pathTiles(components, buildings);
  const blocked = blockedTiles(components, buildings, targets);
  const r = rng(hash(layoutKey(components, buildings)));

  // Ground tiles with per-tile colour variation.
  const pos: number[] = [];
  const col: number[] = [];
  const grassA = new THREE.Color("#6f9a3c"), grassB = new THREE.Color("#5c8a32"), dirt = new THREE.Color("#b08f5c");
  const tmp = new THREE.Color();
  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      const isPath = paths.has(k(x, y));
      if (isPath) tmp.copy(dirt).offsetHSL(0, 0, (r() - 0.5) * 0.05);
      else tmp.copy(grassA).lerp(grassB, r()).offsetHSL((r() - 0.5) * 0.02, 0, (r() - 0.5) * 0.04);
      // Two triangles wound so the normal points up (+y).
      const quad = [x, y, x, y + 1, x + 1, y + 1, x, y, x + 1, y + 1, x + 1, y];
      for (let i = 0; i < 6; i++) {
        pos.push(quad[i * 2], 0, quad[i * 2 + 1]);
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.receiveShadow = true;
  ground.name = "ground";
  ground.userData = { kind: "ground" };
  group.add(ground);

  // Wild land beyond the map edge.
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat("#46682a"));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(MAP_SIZE / 2, -0.02, MAP_SIZE / 2);
  outer.receiveShadow = true;
  group.add(outer);
  // A dark border stripe framing the playable map.
  const edge = new THREE.Mesh(new THREE.RingGeometry(MAP_SIZE * 0.7071, MAP_SIZE * 0.7071 + 0.25, 4, 1), mat("#3a4f22"));
  edge.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  edge.position.set(MAP_SIZE / 2, -0.01, MAP_SIZE / 2);
  group.add(edge);

  // Trees: sparse inside, dense forest ring outside.
  const trees: { x: number; z: number; s: number; pine: boolean }[] = [];
  for (let x = -5; x < MAP_SIZE + 5; x++) {
    for (let y = -5; y < MAP_SIZE + 5; y++) {
      const inside = x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE;
      if (inside && (blocked.has(k(x, y)) || paths.has(k(x, y)))) continue;
      const edgeDist = inside ? Math.min(x, y, MAP_SIZE - 1 - x, MAP_SIZE - 1 - y) : -1;
      const p = !inside ? 0.62 : edgeDist < 1 ? 0.3 : 0.07;
      if (r() > p) continue;
      trees.push({ x: x + 0.3 + r() * 0.4, z: y + 0.3 + r() * 0.4, s: 0.75 + r() * 0.5, pine: r() < 0.55 });
    }
  }
  group.add(buildTrees(trees, r));

  // Rocks.
  const rocks: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < 40 && rocks.length < 16; i++) {
    const x = Math.floor(r() * MAP_SIZE), y = Math.floor(r() * MAP_SIZE);
    if (blocked.has(k(x, y)) || paths.has(k(x, y))) continue;
    rocks.push({ x: x + 0.2 + r() * 0.6, z: y + 0.2 + r() * 0.6, s: 0.15 + r() * 0.22 });
  }
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMesh = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ flatShading: true }), rocks.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  rocks.forEach((rk, i) => {
    q.setFromEuler(e.set(r(), r() * 6, r()));
    m4.compose(new THREE.Vector3(rk.x, rk.s * 0.4, rk.z), q, new THREE.Vector3(rk.s, rk.s * 0.7, rk.s));
    rockMesh.setMatrixAt(i, m4);
    rockMesh.setColorAt(i, new THREE.Color().setHSL(0.1, 0.05, 0.45 + r() * 0.15));
  });
  rockMesh.castShadow = rockMesh.receiveShadow = true;
  group.add(rockMesh);

  return group;
}

function buildTrees(trees: { x: number; z: number; s: number; pine: boolean }[], r: () => number) {
  const g = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.5, 5);
  trunkGeo.translate(0, 0.25, 0);
  const coneA = new THREE.ConeGeometry(0.42, 0.7, 6);
  coneA.translate(0, 0.65, 0);
  const coneB = new THREE.ConeGeometry(0.3, 0.55, 6);
  coneB.translate(0, 1.0, 0);
  const crown = new THREE.IcosahedronGeometry(0.42, 0);
  crown.translate(0, 0.78, 0);

  const pines = trees.filter((t) => t.pine), oaks = trees.filter((t) => !t.pine);
  const trunk = new THREE.InstancedMesh(trunkGeo, mat("#6b4a2b"), trees.length);
  const lowCone = new THREE.InstancedMesh(coneA, new THREE.MeshLambertMaterial({ flatShading: true }), pines.length);
  const topCone = new THREE.InstancedMesh(coneB, new THREE.MeshLambertMaterial({ flatShading: true }), pines.length);
  const crowns = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ flatShading: true }), oaks.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  trees.forEach((t, i) => {
    q.setFromAxisAngle(up, r() * Math.PI * 2);
    m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
    trunk.setMatrixAt(i, m4);
  });
  pines.forEach((t, i) => {
    q.setFromAxisAngle(up, r() * Math.PI * 2);
    m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
    lowCone.setMatrixAt(i, m4);
    topCone.setMatrixAt(i, m4);
    c.setHSL(0.3 + r() * 0.04, 0.45, 0.22 + r() * 0.06);
    lowCone.setColorAt(i, c);
    topCone.setColorAt(i, c.offsetHSL(0, 0, 0.04));
  });
  oaks.forEach((t, i) => {
    q.setFromAxisAngle(up, r() * Math.PI * 2);
    m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + r() * 0.3), t.s));
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, c.setHSL(0.22 + r() * 0.06, 0.5, 0.3 + r() * 0.08));
  });
  for (const im of [trunk, lowCone, topCone, crowns]) {
    im.castShadow = true;
    im.receiveShadow = true;
    g.add(im);
  }
  return g;
}

export type Router = (from: THREE.Vector3, to: THREE.Vector3) => THREE.Vector3[];

/**
 * Visual routing through zone gates: units leave and enter walled zones through their gate instead of
 * walking through walls. Returns waypoints (world space) before `to`; empty when the straight line is fine.
 */
export function makeRouter(components: Component[], buildings: Building[]): Router {
  const lib = libraryOf(buildings);
  const zones = components.map((c) => {
    const g = zoneGate(c, lib);
    const { x, y, w, h } = c.zone;
    const gx = g.x + 0.5, gz = g.y + 0.5;
    // Outside point = in front of the gap; inside point = one tile in.
    const d = { n: [0, 1], s: [0, -1], e: [-1, 0], w: [1, 0] }[g.side];
    return {
      inside: (p: THREE.Vector3) => p.x > x && p.x < x + w && p.z > y && p.z < y + h,
      out: new THREE.Vector3(gx, 0, gz),
      in: new THREE.Vector3(gx + d[0] * 1.2, 0, gz + d[1] * 1.2),
    };
  });
  return (from, to) => {
    const exits: THREE.Vector3[] = [], entries: THREE.Vector3[] = [];
    for (const z of zones) {
      const a = z.inside(from), b = z.inside(to);
      if (a === b) continue;
      if (a) exits.push(z.in, z.out);
      else entries.push(z.out, z.in);
    }
    const pts = [...exits, ...entries].map((p) => p.clone());
    // Skip leading waypoints we are already at or past (standing in the gate gap).
    while (pts.length && pts[0].distanceTo(from) < 0.6) pts.shift();
    return pts;
  };
}
