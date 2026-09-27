// Props: farms (tilled field, wheat rows, fence, scarecrow) and small clutter (crates, barrels, hay, carts).
// Explicit spots come from PropsSpec; with a layout (size, blocked, paths) farms are also placed on the
// outskirts, never on the central walk area. Everything is low (under 0.4) except the scarecrow.
// All pieces are instanced: about 9 draws in total. World coordinates.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Handle, PropsSpec } from "../types";
import { rng } from "./kit";

export type { PropsSpec };
export interface PropsArt extends Handle { tick(t: number, dt: number): void }
export interface PropsLayout {
  size?: number;
  blocked?: [number, number][];
  paths?: [number, number][][];
  /** Auto farms on the outskirts when a size is given (default 3). */
  farms?: number;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function part(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: number[] = [0, 0, 0], rot: number[] = [0, 0, 0], sc: number[] = [1, 1, 1]) {
  _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.set(sc[0], sc[1], sc[2]));
  const o = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(_m);
  for (const n of Object.keys(o.attributes)) if (n !== "position" && n !== "normal") o.deleteAttribute(n);
  const c = new THREE.Color(color), n = o.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  o.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.dispose();
  return o;
}
const merge = (parts: THREE.BufferGeometry[]) => { const g = mergeGeometries(parts, false)!; parts.forEach((p) => p.dispose()); return g; };
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

class Batch {
  mats: THREE.Matrix4[] = [];
  cols: THREE.Color[] = [];
  constructor(public geo: THREE.BufferGeometry, public material: THREE.Material, public cast = true) {}
  put(x: number, y: number, z: number, ry = 0, sc: number[] = [1, 1, 1], color?: THREE.ColorRepresentation) {
    this.mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sc[0], sc[1], sc[2])));
    this.cols.push(new THREE.Color(color ?? "#ffffff"));
  }
  build() {
    if (!this.mats.length) return null;
    const im = new THREE.InstancedMesh(this.geo, this.material, this.mats.length);
    this.mats.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, this.cols[i]); });
    im.castShadow = this.cast;
    im.receiveShadow = true;
    im.frustumCulled = false;
    return im;
  }
}

let furrowT: THREE.CanvasTexture | null = null;
function furrowTex() {
  if (furrowT) return furrowT;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  for (let j = 0; j < 8; j++) {
    const g = x.createLinearGradient(0, j * 8, 0, j * 8 + 8);
    g.addColorStop(0, "#7a5a36"); g.addColorStop(0.5, "#a07a4c"); g.addColorStop(1, "#6a4c2c");
    x.fillStyle = g;
    x.fillRect(0, j * 8, 64, 8);
  }
  furrowT = new THREE.CanvasTexture(c);
  furrowT.wrapS = furrowT.wrapT = THREE.RepeatWrapping;
  furrowT.colorSpace = THREE.SRGBColorSpace;
  return furrowT;
}

export function makeProps(spec: PropsSpec, layout: PropsLayout = {}): PropsArt {
  const r = rng((spec.seed ?? 5) * 977 + 3);
  const group = new THREE.Group();
  group.name = "art:props";
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T) => { owned.push(x); return x; };
  const vcol = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  const white = own(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, flatShading: true }));

  const WOOD = "#8a5f36", DARK = "#5a3a20";
  const wheat = new Batch(own(merge([part(new THREE.ConeGeometry(0.035, 0.26, 3), "#ffffff", [0, 0.13, 0]), part(new THREE.ConeGeometry(0.03, 0.2, 3), "#ffffff", [0.03, 0.1, 0.02], [0.2, 0, 0.2])])), white, false);
  const post = new Batch(own(part(B(0.045, 0.3, 0.045), DARK, [0, 0.15, 0])), vcol);
  const rail = new Batch(own(merge([part(B(1, 0.03, 0.025), WOOD, [0, 0.12, 0]), part(B(1, 0.03, 0.025), WOOD, [0, 0.23, 0])])), vcol);
  const scarecrow = new Batch(own(merge([
    part(B(0.035, 0.62, 0.035), DARK, [0, 0.31, 0]),
    part(B(0.36, 0.03, 0.03), DARK, [0, 0.46, 0]),
    part(B(0.16, 0.2, 0.08), "#9a3b2c", [0, 0.42, 0]),
    part(new THREE.IcosahedronGeometry(0.06, 0), "#e3cf8a", [0, 0.6, 0]),
    part(new THREE.ConeGeometry(0.1, 0.08, 6), "#b8903a", [0, 0.67, 0]),
  ])), vcol);
  const crate = new Batch(own(merge([part(B(0.2, 0.2, 0.2), "#a57a45", [0, 0.1, 0]), part(B(0.21, 0.03, 0.21), DARK, [0, 0.19, 0]), part(B(0.21, 0.03, 0.21), DARK, [0, 0.01, 0])])), vcol);
  const barrel = new Batch(own(merge([
    part(new THREE.CylinderGeometry(0.085, 0.085, 0.22, 8), "#8a5a32", [0, 0.11, 0]),
    part(new THREE.CylinderGeometry(0.088, 0.088, 0.025, 8), "#3a3a3e", [0, 0.05, 0]),
    part(new THREE.CylinderGeometry(0.088, 0.088, 0.025, 8), "#3a3a3e", [0, 0.17, 0]),
  ])), vcol);
  const hay = new Batch(own(merge([part(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 9), "#d8b95c", [0, 0.12, 0], [0, 0, Math.PI / 2]), part(new THREE.CylinderGeometry(0.121, 0.121, 0.03, 9), "#a8873a", [0, 0.12, 0], [0, 0, Math.PI / 2])])), vcol);
  const cart = new Batch(own(merge([
    part(B(0.5, 0.06, 0.3), WOOD, [0, 0.2, 0]),
    part(B(0.5, 0.1, 0.02), WOOD, [0, 0.27, 0.14]), part(B(0.5, 0.1, 0.02), WOOD, [0, 0.27, -0.14]),
    part(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 10), DARK, [0, 0.12, 0.17], [Math.PI / 2, 0, 0]),
    part(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 10), DARK, [0, 0.12, -0.17], [Math.PI / 2, 0, 0]),
    part(B(0.4, 0.03, 0.03), DARK, [0.42, 0.17, 0.08]), part(B(0.4, 0.03, 0.03), DARK, [0.42, 0.17, -0.08]),
    part(new THREE.IcosahedronGeometry(0.12, 0), "#d8b95c", [-0.05, 0.3, 0], [0, 0, 0], [1.6, 0.6, 1]),
  ])), vcol);
  const soilParts: THREE.BufferGeometry[] = [];

  /** Farm field w x h tiles with its corner at tile (tx, ty); rows run along the longer side. */
  const farm = (tx: number, ty: number, w: number, h: number) => {
    const alongX = w >= h;
    const soil = new THREE.PlaneGeometry(w - 0.2, h - 0.2).rotateX(-Math.PI / 2).translate(tx + w / 2, 0.006, ty + h / 2);
    const uv = soil.attributes.uv, pos = soil.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, alongX ? pos.getX(i) : pos.getZ(i), (alongX ? pos.getZ(i) : pos.getX(i)) * 1.25);
    soilParts.push(soil);
    // Wheat rows (ripe gold or young green per field)
    const ripe = r() < 0.7;
    for (let a = 0.25; a < (alongX ? h : w) - 0.2; a += 0.2) for (let b = 0.2; b < (alongX ? w : h) - 0.2; b += 0.13) {
      if (r() < 0.08) continue;
      const x = tx + (alongX ? b : a) + (r() - 0.5) * 0.04, z = ty + (alongX ? a : b) + (r() - 0.5) * 0.04;
      const c = ripe ? new THREE.Color().setHSL(0.12 + r() * 0.03, 0.62, 0.52 + r() * 0.1) : new THREE.Color().setHSL(0.22 + r() * 0.04, 0.5, 0.38 + r() * 0.08);
      wheat.put(x, 0, z, r() * 6, [1, 0.8 + r() * 0.5, 1], c);
    }
    // Fence around the field with a gap on the south side
    const fence = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 0.5)), ry = Math.abs(bx - ax) > Math.abs(bz - az) ? 0 : Math.PI / 2;
      for (let k = 0; k <= n; k++) post.put(ax + ((bx - ax) * k) / n, 0, az + ((bz - az) * k) / n);
      for (let k = 0; k < n; k++) rail.put(ax + ((bx - ax) * (k + 0.5)) / n, 0, az + ((bz - az) * (k + 0.5)) / n, ry, [len / n, 1, 1]);
    };
    const x0 = tx + 0.05, z0 = ty + 0.05, x1 = tx + w - 0.05, z1 = ty + h - 0.05, mid = (x0 + x1) / 2;
    fence(x0, z0, x1, z0); fence(x0, z0, x0, z1); fence(x1, z0, x1, z1);
    fence(x0, z1, mid - 0.3, z1); fence(mid + 0.3, z1, x1, z1);
    scarecrow.put(tx + w * (0.3 + r() * 0.4), 0, ty + h * (0.3 + r() * 0.4), r() * 6);
    hay.put(mid + 0.55, 0, z1 + 0.25, r() * 6);
  };

  const clutter = (kind: string, x: number, z: number) => {
    if (kind === "crates") { crate.put(x - 0.1, 0, z, r()); crate.put(x + 0.14, 0, z + 0.08, r(), [0.85, 0.85, 0.85]); crate.put(x - 0.05, 0.2, z + 0.02, r(), [0.8, 0.8, 0.8]); }
    else if (kind === "barrels") for (let i = 0; i < 3; i++) barrel.put(x + (r() - 0.5) * 0.4, 0, z + (r() - 0.5) * 0.4, r() * 6);
    else if (kind === "hay") for (let i = 0; i < 3; i++) hay.put(x + (r() - 0.5) * 0.45, 0, z + (r() - 0.5) * 0.45, r() * 6);
    else if (kind === "cart") cart.put(x, 0, z, r() * 6);
  };

  for (const s of spec.spots) {
    const kind = s.kind ?? "crates";
    if (kind === "farm") farm(s.x, s.y, 2, 2);
    else clutter(kind, s.x + 0.5, s.y + 0.5);
  }

  // Auto farms on the outskirts: free 3 x 2 or 2 x 3 fields with edge distance 1..3, clear of blocked and roads.
  if (layout.size) {
    const size = layout.size;
    const taken = new Set((layout.blocked ?? []).map(([x, y]) => `${x},${y}`));
    const road = new Set<string>();
    // Rasterise road polylines (x first, then y per segment; the board's roads are axis-aligned L shapes).
    for (const line of layout.paths ?? []) for (let i = 1; i < line.length; i++) {
      let [x, y] = line[i - 1];
      const [bx, by] = line[i];
      while (x !== bx || y !== by) {
        road.add(`${x},${y}`);
        if (x !== bx) x += Math.sign(bx - x); else y += Math.sign(by - y);
      }
      road.add(`${x},${y}`);
    }
    const clear = (x: number, y: number, w: number, h: number) => {
      for (let i = x - 1; i <= x + w; i++) for (let j = y - 1; j <= y + h; j++) {
        if (i < x || j < y || i >= x + w || j >= y + h) { if (road.has(`${i},${j}`)) return false; continue; }
        if (i < 1 || j < 1 || i > size - 2 || j > size - 2 || taken.has(`${i},${j}`) || road.has(`${i},${j}`)) return false;
      }
      return true;
    };
    const cands: [number, number, number, number][] = [];
    for (let x = 1; x < size - 2; x++) for (let y = 1; y < size - 2; y++) for (const [w, h] of [[3, 2], [2, 3]]) {
      const edge = Math.min(x - 1, y - 1, size - 1 - (x + w), size - 1 - (y + h));
      if (edge > 2 || !clear(x, y, w, h)) continue;
      cands.push([x, y, w, h]);
    }
    for (let k = cands.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [cands[k], cands[j]] = [cands[j], cands[k]]; }
    let n = 0;
    for (const [x, y, w, h] of cands) {
      if (n >= (layout.farms ?? 3)) break;
      let ok = true;
      for (let i = x - 1; i <= x + w && ok; i++) for (let j = y - 1; j <= y + h; j++) if (taken.has(`${i},${j}`)) { ok = false; break; }
      if (!ok) continue;
      farm(x, y, w, h);
      for (let i = x - 1; i <= x + w; i++) for (let j = y - 1; j <= y + h; j++) taken.add(`${i},${j}`);
      n++;
    }
  }

  if (soilParts.length) {
    const sg = own(mergeGeometries(soilParts.map((g) => g.toNonIndexed()), false)!);
    soilParts.forEach((g) => g.dispose());
    const sm = own(new THREE.MeshStandardMaterial({ map: furrowTex(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const soil = new THREE.Mesh(sg, sm);
    soil.receiveShadow = true;
    group.add(soil);
  }
  const meshes: THREE.InstancedMesh[] = [];
  for (const b of [wheat, post, rail, scarecrow, crate, barrel, hay, cart]) {
    const im = b.build();
    if (im) { meshes.push(im); group.add(im); }
  }
  return {
    object3d: group,
    tick() {},
    dispose() {
      for (const m of meshes) m.dispose();
      for (const o of owned) o.dispose();
    },
  };
}
