// Component zones: cobbled district plate, low stone walls with a gate toward the Library, corner towers, banner.
import * as THREE from "three";
import type { Building, Component } from "../core";
import { zoneGate } from "./terrain";
import { cobbleTexture, makeLabel, mat, mergeStatic, mesh } from "./util";

export const ZONE_COLORS = ["#b8433a", "#3f73b8", "#c9a227", "#7b4fa3", "#2f8f7a", "#c8662c", "#5f7f3a", "#8a5a44"];
const WALL = "#9d968a", WALL_TOP = "#b9b2a4";
const WALL_H = 0.38, WALL_T = 0.16, GATE_W = 1.4;

export function zoneColor(index: number) {
  return ZONE_COLORS[index % ZONE_COLORS.length];
}

export function buildZones(components: Component[], buildings: Building[]) {
  const group = new THREE.Group();
  group.name = "zones";
  const libB = buildings.find((b) => b.kind === "gbrain") ?? { x: 11, y: 11 };
  const wallGeoCache = new Map<string, THREE.BoxGeometry>();
  const box = (w: number, h: number, d: number) => {
    const key = `${w.toFixed(3)},${h},${d.toFixed(3)}`;
    let g = wallGeoCache.get(key);
    if (!g) wallGeoCache.set(key, (g = new THREE.BoxGeometry(w, h, d)));
    return g;
  };
  const towerGeo = new THREE.CylinderGeometry(0.2, 0.23, 0.72, 8);
  const towerRoofGeo = new THREE.ConeGeometry(0.28, 0.4, 8);

  components.forEach((c, i) => {
    const { x, y, w, h } = c.zone;
    const color = zoneColor(i);
    const zg = new THREE.Group();
    zg.name = `zone:${c.id}`;
    zg.userData = { kind: "zone", id: c.id };

    // Plate
    const tex = cobbleTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(w / 2, h / 2);
    const plateMat = new THREE.MeshLambertMaterial({ map: tex, color: new THREE.Color(color).lerp(new THREE.Color("#e8dcc0"), 0.72) });
    const plate = mesh(new THREE.BoxGeometry(w, 0.06, h), plateMat, x + w / 2, 0.03, y + h / 2, false);
    zg.add(plate);

    // Walls along the four edges, with a gap on the gate side.
    const gate = zoneGate(c, libB);
    const wallMat = mat(WALL), topMat = mat(WALL_TOP);
    const addWall = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.05) return;
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const seg = mesh(box(alongX ? len : WALL_T, WALL_H, alongX ? WALL_T : len), wallMat, (x0 + x1) / 2, WALL_H / 2 + 0.06, (z0 + z1) / 2);
      zg.add(seg);
      // Crenellations
      const n = Math.floor(len / 0.4);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const m = mesh(box(0.14, 0.1, 0.14), topMat, x0 + (x1 - x0) * t, WALL_H + 0.11, z0 + (z1 - z0) * t);
        zg.add(m);
      }
    };
    const edge = (side: "n" | "s" | "e" | "w", x0: number, z0: number, x1: number, z1: number) => {
      if (gate.side !== side) return addWall(x0, z0, x1, z1);
      // Split around the gate centre.
      const alongX = side === "n" || side === "s";
      const gc = alongX ? gate.x + 0.5 : gate.y + 0.5;
      if (alongX) {
        addWall(x0, z0, gc - GATE_W / 2, z1);
        addWall(gc + GATE_W / 2, z0, x1, z1);
        addGateTowers(zg, gc - GATE_W / 2, z0, gc + GATE_W / 2, z1, color);
      } else {
        addWall(x0, z0, x1, gc - GATE_W / 2);
        addWall(x0, gc + GATE_W / 2, x1, z1);
        addGateTowers(zg, x0, gc - GATE_W / 2, x1, gc + GATE_W / 2, color);
      }
    };
    edge("n", x, y, x + w, y);
    edge("s", x, y + h, x + w, y + h);
    edge("w", x, y, x, y + h);
    edge("e", x + w, y, x + w, y + h);

    // Corner towers
    const roofMat = mat(color);
    for (const [tx, tz] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      zg.add(mesh(towerGeo, wallMat, tx, 0.36 + 0.06, tz));
      zg.add(mesh(towerRoofGeo, roofMat, tx, 0.78 + 0.2 + 0.06, tz));
    }

    // Banner on a pole in the north-west corner area, and the district name.
    const pole = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5), mat("#5a3d22"), x + 0.6, 0.65 + 0.06, y + 0.6);
    const flag = mesh(new THREE.BoxGeometry(0.02, 0.36, 0.5), mat(color), x + 0.6, 1.15, y + 0.6 + 0.26);
    flag.name = "flag";
    zg.add(pole, flag);
    const label = makeLabel(c.name, { height: 0.46 });
    label.position.set(x + w / 2, 0.55, y + 0.1);
    zg.add(label);

    group.add(zg);
  });
  return mergeStatic(group);
}

function addGateTowers(g: THREE.Group, x0: number, z0: number, x1: number, z1: number, color: string) {
  const geo = new THREE.BoxGeometry(0.3, 0.62, 0.3);
  const roof = new THREE.ConeGeometry(0.26, 0.3, 4);
  for (const [x, z] of [[x0, z0], [x1, z1]]) {
    g.add(mesh(geo, mat(WALL), x, 0.31 + 0.06, z));
    const r = mesh(roof, mat(color), x, 0.62 + 0.15 + 0.06, z);
    r.rotation.y = Math.PI / 4;
    g.add(r);
  }
}
