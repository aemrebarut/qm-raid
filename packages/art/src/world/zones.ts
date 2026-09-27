// Zones (component districts): grass floor worn to dirt, a cobbled lane from the gate to the centre, thick
// crenellated stone walls on a dark plinth, round corner towers with conical roofs in the zone colour, a
// gatehouse with big zone banners and a flag, and a few props along the inside of the walls (tall ones only
// on the back edges so they never hide camps). Every piece kind is one InstancedMesh across all zones.
// World coordinates: zone tiles x..x+w, y..y+h map to world x..x+w, z..z+h.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Handle, ZoneSpec } from "../types";
import { cobbleTex, gable, groundTex, mat, rng, slabRoof, stoneTex, worldUV } from "./kit";

export type { ZoneSpec };
export interface ZonesArt extends Handle { tick(t: number, dt: number): void }
export interface ZonesOpts {
  seed?: number;
  /** Tiles that must stay clear of props (camps, unit staging). */
  blocked?: [number, number][];
}

const WALL_H = 0.5, WALL_T = 0.24, GATE_W = 1.4;
type Side = "n" | "s" | "e" | "w";

// ---------- geometry helpers ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function xf(g: THREE.BufferGeometry, pos: number[] = [0, 0, 0], rot: number[] = [0, 0, 0], sc: number[] = [1, 1, 1]) {
  _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.set(sc[0], sc[1], sc[2]));
  const out = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(_m);
  for (const n of Object.keys(out.attributes)) if (n !== "position" && n !== "normal") out.deleteAttribute(n);
  return out;
}
/** A part with a baked vertex colour, for multi-colour props in one draw. */
function part(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos?: number[], rot?: number[], sc?: number[]) {
  const o = xf(g, pos, rot, sc);
  const c = new THREE.Color(color), n = o.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  o.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return o;
}
function merge(parts: THREE.BufferGeometry[], uv = false) {
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  if (uv) worldUV(g, 1);
  return g;
}
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** Collects instance transforms, then makes one InstancedMesh. */
class Batch {
  mats: THREE.Matrix4[] = [];
  cols: THREE.Color[] = [];
  constructor(public geo: THREE.BufferGeometry, public material: THREE.Material, public cast = true) {}
  put(pos: number[], ry = 0, sc: number[] = [1, 1, 1], color?: THREE.ColorRepresentation, rx = 0, rz = 0) {
    this.mats.push(new THREE.Matrix4().compose(new THREE.Vector3(pos[0], pos[1], pos[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sc[0], sc[1], sc[2])));
    this.cols.push(new THREE.Color(color ?? "#ffffff"));
  }
  build() {
    const im = new THREE.InstancedMesh(this.geo, this.material, Math.max(1, this.mats.length));
    im.count = this.mats.length;
    this.mats.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, this.cols[i]); });
    im.castShadow = this.cast;
    im.receiveShadow = true;
    im.frustumCulled = false; // instances span the whole map
    return im;
  }
}

// ---------- textures ----------
let bannerT: THREE.CanvasTexture | null = null;
/** Greyscale heraldic banner (tinted by the zone colour): field, gold-ish trim, a tower charge. */
function bannerTex() {
  if (bannerT) return bannerT;
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, 64, 128);
  x.fillStyle = "#e9e0c8"; // trim reads as a light tint of the zone colour
  x.fillRect(0, 0, 64, 7); x.fillRect(0, 0, 5, 128); x.fillRect(59, 0, 5, 128);
  x.fillStyle = "#6a6a6a"; // charge: a small keep
  x.fillRect(22, 42, 20, 26); x.fillRect(18, 34, 6, 10); x.fillRect(29, 34, 6, 10); x.fillRect(40, 34, 6, 10);
  x.fillStyle = "#ffffff"; x.fillRect(29, 56, 6, 12);
  // swallowtail
  x.globalCompositeOperation = "destination-out";
  x.beginPath(); x.moveTo(0, 128); x.lineTo(32, 104); x.lineTo(64, 128); x.closePath(); x.fill();
  bannerT = new THREE.CanvasTexture(c);
  bannerT.colorSpace = THREE.SRGBColorSpace;
  return bannerT;
}

// ---------- noise for the floor ----------
function vnoise(x: number, y: number, seed: number) {
  const h = (i: number, j: number) => { let k = Math.imul(i, 374761393) + Math.imul(j, 668265263) + seed * 1013; k = Math.imul(k ^ (k >>> 13), 1274126177); return ((k ^ (k >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), xf2 = x - xi, yf = y - yi, u = xf2 * xf2 * (3 - 2 * xf2), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- main ----------
export function makeZones(zones: ZoneSpec[], opts: ZonesOpts = {}): ZonesArt {
  const seed = opts.seed ?? 11;
  const r = rng(seed * 131 + 7);
  const blocked = new Set((opts.blocked ?? []).map(([x, y]) => `${x},${y}`));
  const group = new THREE.Group();
  group.name = "art:zones";
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T) => { owned.push(x); return x; };

  const stone = mat("#cfc5b1", { map: stoneTex() }), stoneDark = mat("#8f8676", { map: stoneTex() });
  const white = own(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8, flatShading: true }));
  const vcol = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  const bannerMat = own(new THREE.MeshStandardMaterial({ map: bannerTex(), side: THREE.DoubleSide, roughness: 0.85, transparent: false, alphaTest: 0.5 }));
  // Banners hang on shaded tower faces; a self glow in the instance colour keeps the zone identity saturated.
  bannerMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.38;");
  };

  // Piece kinds (geometry in local space, instanced across zones)
  const wallGeo = own(worldUV(xf(B(1, WALL_H, WALL_T), [0, WALL_H / 2, 0]), 1));
  const plinthGeo = own(worldUV(xf(B(1, 0.14, WALL_T + 0.1), [0, 0.07, 0]), 1));
  const crenelGeo = own(merge([
    xf(B(1, 0.05, WALL_T + 0.05), [0, WALL_H + 0.025, 0]),
    xf(B(0.24, 0.14, WALL_T + 0.03), [-0.25, WALL_H + 0.12, 0]),
    xf(B(0.24, 0.14, WALL_T + 0.03), [0.25, WALL_H + 0.12, 0]),
  ], true));
  const towerGeo = own(worldUV(xf(new THREE.CylinderGeometry(0.3, 0.33, 0.95, 10), [0, 0.475, 0]), 1));
  const towerBaseGeo = own(worldUV(xf(new THREE.CylinderGeometry(0.37, 0.4, 0.16, 10), [0, 0.08, 0]), 1));
  const towerRoofGeo = own(merge([xf(new THREE.ConeGeometry(0.42, 0.62, 10), [0, 0.95 + 0.31, 0]), xf(new THREE.CylinderGeometry(0.43, 0.43, 0.04, 10), [0, 0.96, 0])]));
  const finialGeo = own(xf(new THREE.ConeGeometry(0.035, 0.18, 5), [0, 1.66, 0]));
  const GT_H = 1.75; // lintel underside 1.41, portcullis teeth 1.32: clears a 1.2 tall unit
  const gateTowerGeo = own(worldUV(merge([xf(B(0.46, GT_H, 0.46), [0, GT_H / 2, 0]), xf(B(0.54, 0.14, 0.54), [0, 0.07, 0])]), 1));
  const gateRoofGeo = own(xf(new THREE.ConeGeometry(0.4, 0.5, 4), [0, GT_H + 0.25, 0], [0, Math.PI / 4, 0]));
  const lintelGeo = own(worldUV(merge([
    xf(B(1, 0.28, WALL_T + 0.12), [0, GT_H - 0.2, 0]),
    xf(B(0.2, 0.13, WALL_T + 0.14), [-0.3, GT_H, 0]), xf(B(0.2, 0.13, WALL_T + 0.14), [0, GT_H, 0]), xf(B(0.2, 0.13, WALL_T + 0.14), [0.3, GT_H, 0]),
  ]), 1));
  const portGeo = own(merge([
    // raised portcullis: only its teeth show under the lintel
    ...[-0.5, -0.25, 0, 0.25, 0.5].map((x) => xf(B(0.035, 0.1, 0.035), [x * 0.95, GT_H - 0.38, 0])),
    xf(B(1, 0.03, 0.035), [0, GT_H - 0.35, 0]),
  ]));
  const bannerGeo = own(new THREE.PlaneGeometry(0.34, 0.68, 1, 3).translate(0, -0.34, 0));
  const flagGeo = own(new THREE.PlaneGeometry(0.5, 0.3, 3, 1).translate(0.25, -0.15, 0));
  const poleGeo = own(xf(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 5), [0, 0.45, 0]));

  const walls = new Batch(wallGeo, stone), plinths = new Batch(plinthGeo, stoneDark), crenels = new Batch(crenelGeo, stoneDark);
  const towers = new Batch(towerGeo, stone), towerBases = new Batch(towerBaseGeo, stoneDark), towerRoofs = new Batch(towerRoofGeo, white), finials = new Batch(finialGeo, mat("#e8c35a", { metal: 0.6, rough: 0.35 }));
  const gateTowers = new Batch(gateTowerGeo, stone), gateRoofs = new Batch(gateRoofGeo, white), lintels = new Batch(lintelGeo, stoneDark), ports = new Batch(portGeo, mat("#2e2e33", { metal: 0.5, rough: 0.5 }));
  const banners = new Batch(bannerGeo, bannerMat), flags = new Batch(flagGeo, bannerMat), poles = new Batch(poleGeo, mat("#4a2f18"));

  // Props (vertex coloured, one draw per kind)
  const PL = "#e6d9bb", TIMBER = "#5a3a20", THATCH = "#c9a45a", WOOD = "#8a5f36";
  const hutGeo = own(merge([
    part(B(0.62, 0.42, 0.5), PL, [0, 0.21, 0]),
    ...[[-0.31, -0.25], [0.31, -0.25], [-0.31, 0.25], [0.31, 0.25]].map(([x, z]) => part(B(0.05, 0.42, 0.05), TIMBER, [x, 0.21, z])),
    part(B(0.16, 0.26, 0.02), "#3b2614", [0.08, 0.13, 0.255]),
    part(B(0.1, 0.1, 0.02), "#ffcf7a", [-0.17, 0.25, 0.255]),
    part(gable(0.5, 0.62, 0.34), PL, [0, 0.42, 0], [0, Math.PI / 2, 0]),
    part(slabRoof(0.66, 0.78, 0.36, 0.06), THATCH, [0, 0.41, 0], [0, Math.PI / 2, 0]),
  ]));
  const stallGeo = own(merge([
    ...[[-0.3, -0.18], [0.3, -0.18], [-0.3, 0.18], [0.3, 0.18]].map(([x, z]) => part(B(0.04, 0.5, 0.04), WOOD, [x, 0.25, z])),
    part(B(0.64, 0.18, 0.3), WOOD, [0, 0.09, 0.02]),
    ...[[-0.2, "#c8452f"], [0, "#e2b23a"], [0.2, "#6f9a3c"]].map(([x, c]) => part(new THREE.IcosahedronGeometry(0.07, 0), c as string, [x as number, 0.21, 0.04], [0, 0, 0], [1, 0.6, 1])),
  ]));
  const awningGeo = own(merge([xf(B(0.72, 0.03, 0.48), [0, 0.52, 0], [-0.25, 0, 0])]));
  const wellGeo = own(merge([
    part(new THREE.CylinderGeometry(0.2, 0.22, 0.22, 10), "#9a9284", [0, 0.11, 0]),
    part(new THREE.CylinderGeometry(0.15, 0.15, 0.225, 10), "#1f3c55", [0, 0.11, 0]),
    part(B(0.04, 0.42, 0.04), TIMBER, [-0.2, 0.3, 0]), part(B(0.04, 0.42, 0.04), TIMBER, [0.2, 0.3, 0]),
    part(B(0.46, 0.03, 0.03), TIMBER, [0, 0.45, 0]),
    part(gable(0.36, 0.5, 0.18), "#7a4a2c", [0, 0.5, 0], [0, 0, 0]),
    part(new THREE.CylinderGeometry(0.04, 0.035, 0.07, 6), "#6b4a2b", [0.05, 0.33, 0]),
  ]));
  const hayGeo = own(merge([part(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 9), "#d8b95c", [0, 0.12, 0], [0, 0, Math.PI / 2]), part(new THREE.CylinderGeometry(0.121, 0.121, 0.03, 9), "#a8873a", [0, 0.12, 0], [0, 0, Math.PI / 2])]));
  const barrelGeo = own(merge([
    part(new THREE.CylinderGeometry(0.085, 0.085, 0.22, 8), "#8a5a32", [0, 0.11, 0]),
    part(new THREE.CylinderGeometry(0.088, 0.088, 0.025, 8), "#3a3a3e", [0, 0.05, 0]),
    part(new THREE.CylinderGeometry(0.088, 0.088, 0.025, 8), "#3a3a3e", [0, 0.17, 0]),
  ]));
  const crateGeo = own(merge([part(B(0.2, 0.2, 0.2), "#a57a45", [0, 0.1, 0]), part(B(0.21, 0.03, 0.21), "#6b4a2b", [0, 0.19, 0]), part(B(0.21, 0.03, 0.21), "#6b4a2b", [0, 0.01, 0])]));
  const huts = new Batch(hutGeo, vcol), stalls = new Batch(stallGeo, vcol), awnings = new Batch(awningGeo, white), wells = new Batch(wellGeo, vcol);
  const hay = new Batch(hayGeo, vcol), barrels = new Batch(barrelGeo, vcol), crates = new Batch(crateGeo, vcol);

  // Floor overlay (grass worn to dirt) and cobbled lanes, merged across zones
  const fPos: number[] = [], fCol: number[] = [], fUv: number[] = [];
  const lanes: THREE.BufferGeometry[] = [];
  const grassA = new THREE.Color("#78a443"), grassB = new THREE.Color("#658f36"), dirt = new THREE.Color("#a98a5c"), dirtDark = new THREE.Color("#8c7049");
  const tmp = new THREE.Color();

  const waving: { batch: Batch; index: number; base: THREE.Matrix4; phase: number; flag: boolean }[] = [];

  zones.forEach((z, zi) => {
    const color = new THREE.Color(z.color);
    const x0 = z.x, z0 = z.y, x1 = z.x + z.w, z1 = z.y + z.h, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const gate = z.gate ?? { side: "s" as Side, x: Math.floor(cx), y: z1 };
    const side = gate.side as Side;
    const gc = side === "n" || side === "s" ? gate.x + 0.5 : gate.y + 0.5;

    // --- walls ---
    const segment = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) return;
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
      const ry = alongX ? 0 : Math.PI / 2;
      const n = Math.max(1, Math.round(len));
      const piece = len / n;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        walls.put([px, 0, pz], ry, [piece, 1, 1]);
        plinths.put([px, 0, pz], ry, [piece, 1, 1]);
        crenels.put([px, 0, pz], ry, [piece, 1, 1]);
      }
    };
    const edge = (s: Side, ax: number, az: number, bx: number, bz: number) => {
      if (side !== s) return segment(ax, az, bx, bz);
      const alongX = s === "n" || s === "s";
      if (alongX) { segment(ax, az, gc - GATE_W / 2 - 0.23, bz); segment(gc + GATE_W / 2 + 0.23, az, bx, bz); }
      else { segment(ax, az, bx, gc - GATE_W / 2 - 0.23); segment(ax, gc + GATE_W / 2 + 0.23, bx, bz); }
    };
    edge("n", x0 + 0.3, z0, x1 - 0.3, z0);
    edge("s", x0 + 0.3, z1, x1 - 0.3, z1);
    edge("w", x0, z0 + 0.3, x0, z1 - 0.3);
    edge("e", x1, z0 + 0.3, x1, z1 - 0.3);

    // --- corner towers ---
    for (const [tx, tz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      towers.put([tx, 0, tz]);
      towerBases.put([tx, 0, tz]);
      towerRoofs.put([tx, 0, tz], r() * 6, [1, 1, 1], color);
      finials.put([tx, 0, tz]);
    }

    // --- gatehouse ---
    const alongX = side === "n" || side === "s";
    const wallLine = side === "n" ? z0 : side === "s" ? z1 : side === "w" ? x0 : x1;
    const at = (along: number, y = 0): number[] => alongX ? [along, y, wallLine] : [wallLine, y, along];
    const ry = alongX ? 0 : Math.PI / 2;
    for (const o of [-1, 1]) {
      gateTowers.put(at(gc + o * (GATE_W / 2)), ry);
      gateRoofs.put(at(gc + o * (GATE_W / 2)), 0, [1, 1, 1], color);
    }
    lintels.put(at(gc), ry, [GATE_W + 0.2, 1, 1]);
    ports.put(at(gc), ry, [GATE_W - 0.3, 1, 1]);
    // Banners on the camera-facing face of each gate tower (+z for n/s walls, +x for e/w walls)
    for (const o of [-1, 1]) {
      const p = at(gc + o * (GATE_W / 2), GT_H - 0.08);
      if (alongX) p[2] += 0.24; else p[0] += 0.24;
      const bi = banners.mats.length;
      banners.put(p, alongX ? 0 : Math.PI / 2, [1, 1, 1], color);
      waving.push({ batch: banners, index: bi, base: banners.mats[bi].clone(), phase: zi * 1.7 + o, flag: false });
    }
    // Flag on a pole above the gate
    const pp = at(gc, GT_H + 0.05);
    poles.put(pp);
    const fi = flags.mats.length;
    flags.put([pp[0], pp[1] + 0.88, pp[2]], alongX ? 0 : Math.PI / 2, [1, 1, 1], color);
    waving.push({ batch: flags, index: fi, base: flags.mats[fi].clone(), phase: zi * 2.3, flag: true });

    // --- floor: grass worn to dirt toward the middle and along the lane ---
    const inward = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[side];
    const gx = alongX ? gc : wallLine, gz = alongX ? wallLine : gc;
    const laneDist = (px: number, pz: number) => {
      // distance to the segment gate -> centre line (along the inward axis, stopping at the centre)
      const ex = alongX ? gx : cx, ez = alongX ? cz : gz;
      const dx = ex - gx, dz = ez - gz, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((px - gx) * dx + (pz - gz) * dz) / l2));
      return Math.hypot(px - gx - dx * t, pz - gz - dz * t);
    };
    const step = 0.25;
    for (let px = x0; px < x1 - 1e-6; px += step) for (let pz = z0; pz < z1 - 1e-6; pz += step) {
      for (const [vx, vz] of [[px, pz], [px, pz + step], [px + step, pz + step], [px, pz], [px + step, pz + step], [px + step, pz]]) {
        const edgeD = Math.min(vx - x0, x1 - vx, vz - z0, z1 - vz);
        const n = vnoise(vx * 0.9, vz * 0.9, seed + zi) * 0.6 + vnoise(vx * 2.3, vz * 2.3, seed + zi + 5) * 0.4;
        const wear = Math.min(1, smooth(0.4, 2.2, edgeD) * 0.75 + (1 - smooth(0.4, 1.6, laneDist(vx, vz))) * 0.6) * smooth(0.25, 0.65, n + 0.15);
        tmp.copy(grassA).lerp(grassB, vnoise(vx * 0.4, vz * 0.4, seed + 3));
        tmp.lerp(dirt, wear).lerp(dirtDark, wear * wear * 0.35);
        fPos.push(vx, 0.004, vz);
        fCol.push(tmp.r, tmp.g, tmp.b);
        fUv.push(vx * 0.5, vz * 0.5);
      }
    }
    // --- cobbled lane from the gate to the centre, ending in a small round court ---
    const ex = alongX ? gc : cx, ez = alongX ? cz : gc;
    const len = Math.hypot(ex - gx, ez - gz);
    const lane = new THREE.PlaneGeometry(0.9, len + 0.25).rotateX(-Math.PI / 2);
    lane.rotateY(alongX ? 0 : Math.PI / 2);
    lane.translate((gx + ex) / 2 - inward[0] * 0.12, 0.008, (gz + ez) / 2 - inward[1] * 0.12);
    lanes.push(lane.toNonIndexed());
    lanes.push(new THREE.CircleGeometry(0.7, 14).rotateX(-Math.PI / 2).translate(ex, 0.008, ez).toNonIndexed());

    // --- props along the inside of the walls ---
    // Tall props (hut, stall, well) only on the back edges (north, west: far from the camera);
    // low props (hay, barrels, crates) on the front edges. Keep the lane, the centre and blocked tiles clear.
    const cand: { x: number; y: number; back: boolean; face: number }[] = [];
    for (let i = z.x; i < x1; i++) for (let j = z.y; j < z1; j++) {
      const onN = j === z.y, onS = j === z1 - 1, onW = i === z.x, onE = i === x1 - 1;
      if (!(onN || onS || onW || onE)) continue;
      if ((onN || onS) && (onW || onE)) continue; // corners: tower bases
      if (blocked.has(`${i},${j}`) || laneDist(i + 0.5, j + 0.5) < 1.3) continue;
      const face = onN ? 0 : onS ? Math.PI : onW ? Math.PI / 2 : -Math.PI / 2; // face the zone centre
      cand.push({ x: i, y: j, back: onN || onW, face });
    }
    for (let k = cand.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [cand[k], cand[j]] = [cand[j], cand[k]]; }
    const want = Math.min(cand.length, 3 + Math.floor((z.w * z.h) / 16));
    const used = new Set<string>();
    let tall = 0;
    for (const c of cand) {
      if (used.size >= want) break;
      if ([...used].some((u) => { const [ux, uy] = u.split(",").map(Number); return Math.abs(ux - c.x) + Math.abs(uy - c.y) < 2; })) continue;
      used.add(`${c.x},${c.y}`);
      const wx = c.x + 0.5, wz = c.y + 0.5;
      const pick = r();
      if (c.back && tall < 3) {
        tall++;
        if (pick < 0.45) huts.put([wx, 0, wz], c.face);
        else if (pick < 0.75) { stalls.put([wx, 0, wz], c.face); awnings.put([wx, 0, wz], c.face, [1, 1, 1], color.clone().lerp(new THREE.Color("#ffffff"), 0.15)); }
        else wells.put([wx, 0, wz], r() * 6);
      } else if (pick < 0.4) {
        for (let h = 0; h < 2 + Math.floor(r() * 2); h++) hay.put([wx + (r() - 0.5) * 0.5, 0, wz + (r() - 0.5) * 0.5], r() * 6);
      } else if (pick < 0.75) {
        for (let h = 0; h < 2 + Math.floor(r() * 3); h++) barrels.put([wx + (r() - 0.5) * 0.45, 0, wz + (r() - 0.5) * 0.45], r() * 6);
      } else {
        crates.put([wx - 0.1, 0, wz], r());
        crates.put([wx + 0.14, 0, wz + 0.08], r(), [0.85, 0.85, 0.85]);
        crates.put([wx - 0.05, 0.2, wz + 0.02], r(), [0.8, 0.8, 0.8]);
      }
    }
  });

  // Floor and lanes (two draws for every zone)
  if (fPos.length) {
    const fg = own(new THREE.BufferGeometry());
    fg.setAttribute("position", new THREE.Float32BufferAttribute(fPos, 3));
    fg.setAttribute("color", new THREE.Float32BufferAttribute(fCol, 3));
    fg.setAttribute("uv", new THREE.Float32BufferAttribute(fUv, 2));
    fg.computeVertexNormals();
    const fm = own(new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTex(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const floor = new THREE.Mesh(fg, fm);
    floor.receiveShadow = true;
    floor.name = "zoneFloor";
    group.add(floor);
    const lg = own(worldUV(merge(lanes), 1));
    const lm = own(new THREE.MeshStandardMaterial({ color: "#c9bfa8", map: cobbleTex(), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const laneMesh = new THREE.Mesh(lg, lm);
    laneMesh.receiveShadow = true;
    group.add(laneMesh);
  }

  const all = [walls, plinths, crenels, towers, towerBases, towerRoofs, finials, gateTowers, gateRoofs, lintels, ports, banners, flags, poles, huts, stalls, awnings, wells, hay, barrels, crates];
  const meshes = new Map<Batch, THREE.InstancedMesh>();
  for (const b of all) {
    if (!b.mats.length) continue;
    const im = b.build();
    meshes.set(b, im);
    group.add(im);
  }

  const rot = new THREE.Matrix4();
  const bannerMesh = meshes.get(banners), flagMesh = meshes.get(flags);
  const wavers = waving.map((w) => ({ ...w, im: meshes.get(w.batch)! })).filter((w) => w.im);
  return {
    object3d: group,
    tick(t) {
      for (const w of wavers) {
        const a = Math.sin(t * (w.flag ? 3.1 : 1.6) + w.phase) * (w.flag ? 0.35 : 0.08);
        rot.makeRotationFromEuler(_e.set(w.flag ? 0 : a, w.flag ? a : 0, 0));
        w.im.setMatrixAt(w.index, _m.multiplyMatrices(w.base, rot));
      }
      if (bannerMesh) bannerMesh.instanceMatrix.needsUpdate = true;
      if (flagMesh) flagMesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const im of meshes.values()) im.dispose();
      for (const o of owned) o.dispose();
    },
  };
}
