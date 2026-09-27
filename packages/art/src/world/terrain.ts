// Terrain: flat playable map (y = 0) with soft grass colour variation and painted dirt roads, rolling hills
// and forest beyond the edge, a river with sandy banks outside the west edge, rocks, grass tufts and flowers.
// Tall things (trees, big rocks) never stand on the walk area: inside the map they only grow in a thin
// band along the edge, away from `blocked` tiles (dilated by one tile) and roads. World coordinates.
import * as THREE from "three";
import type { Handle, TerrainSpec } from "../types";
import { groundTex, mat, rng } from "./kit";

export type { TerrainSpec };
export interface TerrainArt extends Handle {
  tick(t: number, dt: number): void;
  /** Ground height at world (x, z); 0 everywhere on the playable map. */
  heightAt(x: number, z: number): number;
}

const MARGIN = 16; // land drawn beyond the map edge, in tiles

// ---------- noise ----------
function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, seed: number) {
  return valueNoise(x, y, seed) * 0.55 + valueNoise(x * 2.1, y * 2.1, seed + 1) * 0.3 + valueNoise(x * 4.3, y * 4.3, seed + 2) * 0.15;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- roads ----------
type Seg = [number, number, number, number];
function segments(paths: [number, number][][]) {
  const segs: Seg[] = [];
  for (const line of paths) {
    const pts = line.map(([x, y]) => [x + 0.5, y + 0.5]); // tile centres
    if (pts.length === 1) segs.push([pts[0][0], pts[0][1], pts[0][0], pts[0][1]]);
    for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
  }
  return segs;
}
function segDist(px: number, pz: number, s: Seg) {
  const dx = s[2] - s[0], dz = s[3] - s[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (pz - s[1]) * dz) / l2)) : 0;
  return Math.hypot(px - s[0] - dx * t, pz - s[1] - dz * t);
}

export function makeTerrain(spec: TerrainSpec): TerrainArt {
  const size = spec.size, seed = spec.seed ?? 7;
  const r = rng(seed * 7919 + 13);
  const segs = segments(spec.paths ?? []);
  const roadDist = (x: number, z: number) => { let d = 99; for (const s of segs) d = Math.min(d, segDist(x, z, s)); return d; };
  const blocked = new Set((spec.blocked ?? []).map(([x, y]) => `${x},${y}`));
  const nearBlocked = (tx: number, ty: number, pad: number) => {
    for (let i = -pad; i <= pad; i++) for (let j = -pad; j <= pad; j++) if (blocked.has(`${tx + i},${ty + j}`)) return true;
    return false;
  };

  // River outside the west edge, meandering north to south.
  const riverX = (z: number) => -4.2 + Math.sin(z * 0.22 + seed) * 1.3 + Math.sin(z * 0.07) * 0.8;
  const outside = (x: number, z: number) => Math.max(-x, x - size, -z, z - size, 0);
  const heightAt = (x: number, z: number) => {
    const d = outside(x, z);
    if (d <= 0) return 0;
    let h = smooth(1.2, 7, d) * (0.4 + fbm(x * 0.12, z * 0.12, seed) * 2.2) + smooth(0.6, 3, d) * (fbm(x * 0.5, z * 0.5, seed + 5) - 0.5) * 0.3;
    const rd = Math.abs(x - riverX(z));
    if (x < 0) h = Math.min(h, -0.45 + smooth(0.8, 2.6, rd) * 0.45 + Math.max(0, h) * smooth(2, 5, rd));
    return h * smooth(0, 1, d);
  };

  const group = new THREE.Group();
  group.name = "art:terrain";

  // ---- ground: fine inner grid (roads need crisp edges), coarse outer ring (hills) ----
  const grassA = new THREE.Color("#79a843"), grassB = new THREE.Color("#5f8f34"), grassDry = new THREE.Color("#a3a452");
  const dirt = new THREE.Color("#b3915f"), dirtDark = new THREE.Color("#8f7048"), sand = new THREE.Color("#cdb98a"), rock = new THREE.Color("#8d8a7c");
  const c = new THREE.Color();
  const colorAt = (x: number, z: number, h: number) => {
    const n = fbm(x * 0.18, z * 0.18, seed + 11);
    c.copy(grassA).lerp(grassB, smooth(0.35, 0.75, n));
    c.lerp(grassDry, smooth(0.62, 0.85, fbm(x * 0.09 + 40, z * 0.09, seed + 3)) * 0.55);
    c.offsetHSL(0, 0, (valueNoise(x * 1.7, z * 1.7, seed + 9) - 0.5) * 0.05);
    if (h === 0) {
      const rd = roadDist(x, z);
      if (rd < 0.75) {
        const k = 1 - smooth(0.34, 0.62 + (valueNoise(x * 3, z * 3, seed) - 0.5) * 0.12, rd);
        c.lerp(k > 0.9 ? dirtDark.clone().lerp(dirt, valueNoise(x * 4, z * 4, seed + 2) * 0.8 + 0.2) : dirt, k);
        if (k < 0.5) c.offsetHSL(0, 0, -0.03 * (1 - Math.abs(k - 0.25) * 4)); // trodden fringe
      }
    } else {
      if (h < 0.02 && x < 0) c.lerp(sand, smooth(0.02, -0.2, h));
      if (h > 1.2) c.lerp(rock, smooth(1.2, 2.2, h) * 0.6);
    }
    return c;
  };

  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTex(), roughness: 1, metalness: 0 });
  groundMat.userData.owned = true;
  const grid = (x0: number, z0: number, x1: number, z1: number, step: number, skip: (x: number, z: number) => boolean) => {
    const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
    const pos: number[] = [], col: number[] = [], uv: number[] = [];
    const vx = (i: number) => x0 + i * step, vz = (j: number) => z0 + j * step;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const ax = vx(i), az = vz(j), bx = vx(i + 1), bz = vz(j + 1);
      if (skip((ax + bx) / 2, (az + bz) / 2)) continue;
      for (const [x, z] of [[ax, az], [ax, bz], [bx, bz], [ax, az], [bx, bz], [bx, az]]) {
        const h = heightAt(x, z);
        pos.push(x, h, z);
        const k = colorAt(x, z, h);
        col.push(k.r, k.g, k.b);
        uv.push(x * 0.5, z * 0.5);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, groundMat);
    m.receiveShadow = true;
    return m;
  };
  const inner = grid(0, 0, size, size, 0.25, () => false);
  inner.name = "ground";
  inner.userData = { kind: "ground" };
  const outer = grid(-MARGIN, -MARGIN, size + MARGIN, size + MARGIN, 0.5, (x, z) => x > 0 && x < size && z > 0 && z < size);
  group.add(inner, outer);

  // ---- water ----
  const waterMat = new THREE.MeshStandardMaterial({ color: "#3d7fae", roughness: 0.18, metalness: 0.15, transparent: true, opacity: 0.88, map: rippleTex() });
  waterMat.userData.owned = true;
  waterMat.map = waterMat.map!.clone();
  waterMat.map.repeat.set(6, 40);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(12, size + MARGIN * 2), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(-6, -0.14, size / 2);
  water.receiveShadow = true;
  group.add(water);

  // ---- trees ----
  type Tree = { x: number; z: number; s: number; kind: 0 | 1 | 2 };
  const trees: Tree[] = [];
  for (let x = -MARGIN; x < size + MARGIN; x++) {
    for (let y = -MARGIN; y < size + MARGIN; y++) {
      const inside = x >= 0 && y >= 0 && x < size && y < size;
      const edgeDist = inside ? Math.min(x, y, size - 1 - x, size - 1 - y) : -1;
      let p: number;
      if (!inside) p = 0.55 + fbm(x * 0.15, y * 0.15, seed + 21) * 0.4;
      else if (edgeDist === 0) p = 0.32;
      else p = 0; // no trees on the playable interior: units must stay readable
      if (inside && (nearBlocked(x, y, 1) || roadDist(x + 0.5, y + 0.5) < 1.3)) p = 0;
      if (r() > p) continue;
      const tx = x + 0.2 + r() * 0.6, tz = y + 0.2 + r() * 0.6;
      const h = heightAt(tx, tz);
      if (h < 0.02 && !inside && tx < 0 && Math.abs(tx - riverX(tz)) < 2.2) continue; // river banks
      const kindR = r();
      trees.push({ x: tx, z: tz, s: 0.75 + r() * 0.55, kind: kindR < 0.5 ? 0 : kindR < 0.85 ? 1 : 2 });
    }
  }
  group.add(buildTrees(trees, heightAt, r));

  // ---- rocks: small ones inside (low), outcrops on the hills ----
  const rocks: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < 400 && rocks.length < 90; i++) {
    const x = -MARGIN + r() * (size + MARGIN * 2), z = -MARGIN + r() * (size + MARGIN * 2);
    const inside = x > 0 && z > 0 && x < size && z < size;
    if (inside) {
      if (rocks.length > 18 || nearBlocked(Math.floor(x), Math.floor(z), 1) || roadDist(x, z) < 0.9) continue;
      rocks.push({ x, z, s: 0.08 + r() * 0.12 });
    } else if (heightAt(x, z) > 0.3 || r() < 0.3) rocks.push({ x, z, s: 0.2 + r() * 0.45 });
  }
  const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat("#ffffff"), rocks.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s3 = new THREE.Vector3();
  rocks.forEach((rk, i) => {
    q.setFromEuler(e.set(r(), r() * 6, r()));
    m4.compose(v.set(rk.x, heightAt(rk.x, rk.z) + rk.s * 0.25, rk.z), q, s3.set(rk.s * (1 + r() * 0.4), rk.s * 0.65, rk.s));
    rockMesh.setMatrixAt(i, m4);
    rockMesh.setColorAt(i, c.setHSL(0.09 + r() * 0.03, 0.06, 0.5 + r() * 0.14));
  });
  rockMesh.castShadow = rockMesh.receiveShadow = true;
  group.add(rockMesh);

  // ---- grass tufts and flowers on open grass (low, never occlude units) ----
  const tufts: [number, number, number][] = [], flowers: [number, number, number][] = [];
  for (let i = 0; i < 2600; i++) {
    const x = -4 + r() * (size + 8), z = -4 + r() * (size + 8);
    const tx = Math.floor(x), tz = Math.floor(z);
    if (blocked.has(`${tx},${tz}`) || roadDist(x, z) < 0.55 || heightAt(x, z) < 0.02 && (x < 0 || z < 0 || x > size || z > size)) continue;
    const n = fbm(x * 0.3, z * 0.3, seed + 31);
    if (n > 0.55 && tufts.length < 900) tufts.push([x, z, 0.6 + r() * 0.7]);
    else if (n < 0.3 && r() < 0.35 && flowers.length < 260) flowers.push([x, z, r()]);
  }
  const tuftGeo = new THREE.ConeGeometry(0.05, 0.16, 3);
  tuftGeo.translate(0, 0.08, 0);
  const tuftMesh = new THREE.InstancedMesh(tuftGeo, mat("#ffffff"), tufts.length * 3);
  let ti = 0;
  for (const [x, z, s] of tufts) for (let k = 0; k < 3; k++) {
    q.setFromEuler(e.set((r() - 0.5) * 0.6, r() * 6, (r() - 0.5) * 0.6));
    m4.compose(v.set(x + (r() - 0.5) * 0.12, heightAt(x, z), z + (r() - 0.5) * 0.12), q, s3.setScalar(s * (0.7 + r() * 0.5)));
    tuftMesh.setMatrixAt(ti, m4);
    tuftMesh.setColorAt(ti++, c.setHSL(0.24 + r() * 0.05, 0.5, 0.3 + r() * 0.1));
  }
  tuftMesh.receiveShadow = true;
  const flowerMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.035, 0), mat("#ffffff", { rough: 0.6 }), flowers.length);
  const petals = ["#f4e9a0", "#f7f2ec", "#d46a8a", "#8fa8e8", "#f0b05a"];
  flowers.forEach(([x, z, k], i) => {
    m4.compose(v.set(x, heightAt(x, z) + 0.05, z), q.identity(), s3.setScalar(0.8 + k * 0.6));
    flowerMesh.setMatrixAt(i, m4);
    flowerMesh.setColorAt(i, c.set(petals[Math.floor(k * petals.length)]));
  });
  group.add(tuftMesh, flowerMesh);

  const ownedGeos = [inner.geometry, outer.geometry, water.geometry, tuftGeo, rockMesh.geometry, flowerMesh.geometry];
  return {
    object3d: group,
    heightAt,
    tick(t) {
      waterMat.map!.offset.set(Math.sin(t * 0.3) * 0.02, -t * 0.05);
    },
    dispose() {
      group.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
      for (const g of ownedGeos) g.dispose();
      groundMat.dispose();
      waterMat.map?.dispose();
      waterMat.dispose();
      for (const g of treeGeos) g.dispose();
    },
  };
}

// ---------- trees: pine, oak, poplar, all instanced ----------
const treeGeos: THREE.BufferGeometry[] = [];
function geo<T extends THREE.BufferGeometry>(g: T) { treeGeos.push(g); return g; }

function buildTrees(trees: { x: number; z: number; s: number; kind: 0 | 1 | 2 }[], heightAt: (x: number, z: number) => number, r: () => number) {
  const g = new THREE.Group();
  const trunkGeo = geo(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 5)).translate(0, 0.25, 0);
  const pineA = geo(new THREE.ConeGeometry(0.44, 0.62, 7)).translate(0, 0.55, 0);
  const pineB = geo(new THREE.ConeGeometry(0.34, 0.55, 7)).translate(0, 0.88, 0);
  const pineC = geo(new THREE.ConeGeometry(0.22, 0.45, 7)).translate(0, 1.17, 0);
  const oakA = geo(new THREE.IcosahedronGeometry(0.4, 0)).translate(0, 0.78, 0);
  const oakB = geo(new THREE.IcosahedronGeometry(0.3, 0)).translate(0.2, 0.95, 0.1);
  const oakC = geo(new THREE.IcosahedronGeometry(0.27, 0)).translate(-0.18, 0.92, -0.12);
  const poplar = geo(new THREE.IcosahedronGeometry(0.28, 1)).scale(1, 2.2, 1).translate(0, 1.0, 0);
  const pines = trees.filter((t) => t.kind === 0), oaks = trees.filter((t) => t.kind === 1), pops = trees.filter((t) => t.kind === 2);
  const leaf = () => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
  const make = (gm: THREE.BufferGeometry, material: THREE.Material, n: number) => {
    const im = new THREE.InstancedMesh(gm, material, n);
    im.castShadow = im.receiveShadow = true;
    g.add(im);
    return im;
  };
  const trunk = make(trunkGeo, mat("#6b4a2b"), trees.length);
  const leafMat = leaf();
  leafMat.userData.owned = true;
  const pa = make(pineA, leafMat, pines.length), pb = make(pineB, leafMat, pines.length), pc = make(pineC, leafMat, pines.length);
  const oa = make(oakA, leafMat, oaks.length), ob = make(oakB, leafMat, oaks.length), oc = make(oakC, leafMat, oaks.length);
  const po = make(poplar, leafMat, pops.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s3 = new THREE.Vector3();
  const c = new THREE.Color();
  const place = (t: { x: number; z: number; s: number }, sy = 1) => {
    q.setFromAxisAngle(up, r() * Math.PI * 2);
    return m4.compose(v.set(t.x, heightAt(t.x, t.z) - 0.02, t.z), q, s3.set(t.s, t.s * sy, t.s));
  };
  trees.forEach((t, i) => trunk.setMatrixAt(i, place(t)));
  pines.forEach((t, i) => {
    place(t, 0.9 + r() * 0.3);
    for (const im of [pa, pb, pc]) im.setMatrixAt(i, m4);
    c.setHSL(0.33 + r() * 0.04, 0.42, 0.2 + r() * 0.06);
    pa.setColorAt(i, c); pb.setColorAt(i, c.offsetHSL(0, 0, 0.03)); pc.setColorAt(i, c.offsetHSL(0, 0, 0.03));
  });
  oaks.forEach((t, i) => {
    place(t, 0.9 + r() * 0.3);
    for (const im of [oa, ob, oc]) im.setMatrixAt(i, m4);
    c.setHSL(0.2 + r() * 0.07, 0.5, 0.3 + r() * 0.08);
    oa.setColorAt(i, c); ob.setColorAt(i, c.offsetHSL(0.01, 0, 0.04)); oc.setColorAt(i, c.offsetHSL(-0.01, 0, -0.02));
  });
  pops.forEach((t, i) => {
    po.setMatrixAt(i, place(t, 1 + r() * 0.3));
    po.setColorAt(i, c.setHSL(0.16 + r() * 0.05, 0.45, 0.34 + r() * 0.08));
  });
  return g;
}

/** Soft ripple streaks for the river (white on grey, tinted by the water colour). */
let ripple: THREE.CanvasTexture | null = null;
function rippleTex() {
  if (ripple) return ripple;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#c8d4dc";
  ctx.fillRect(0, 0, 128, 128);
  const r = rng(5);
  ctx.strokeStyle = "#ffffff";
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.25 + r() * 0.35;
    ctx.lineWidth = 1 + r() * 1.5;
    const x = r() * 128, y = r() * 128;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 4, y + 8, x, y + 14 + r() * 10);
    ctx.stroke();
  }
  ripple = new THREE.CanvasTexture(cv);
  ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping;
  ripple.colorSpace = THREE.SRGBColorSpace;
  return ripple;
}
