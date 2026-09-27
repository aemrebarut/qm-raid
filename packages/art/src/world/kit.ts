// World kit: procedural canvas textures, cached materials, world-scale UVs, and a builder that
// merges static parts into one mesh per material (few draw calls). No game logic, no board imports.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------- textures (drawn once, tinted by material colour) ----------

const texCache = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, r: () => number) => void) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  draw(ctx, rng(size * 31 + key.length * 7 + key.charCodeAt(0)));
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

const grey = (v: number) => `rgb(${v | 0},${v | 0},${v | 0})`;

function speckle(ctx: CanvasRenderingContext2D, r: () => number, size: number, n: number, lo: number, hi: number, a = 0.18) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = grey(lo + r() * (hi - lo));
    ctx.globalAlpha = a;
    ctx.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
  ctx.globalAlpha = 1;
}

/** Ashlar stone blocks: 1 texture repeat = 1 world unit (4 courses). */
export function stoneTex() {
  return canvasTex("stone", 256, (ctx, r) => {
    ctx.fillStyle = grey(120);
    ctx.fillRect(0, 0, 256, 256);
    const rows = 4, rh = 256 / rows;
    for (let row = 0; row < rows; row++) {
      let x = row % 2 ? -40 : 0;
      while (x < 256) {
        const w = 52 + r() * 44;
        const v = 196 + r() * 44;
        ctx.fillStyle = grey(v);
        ctx.fillRect(x + 3, row * rh + 3, w - 6, rh - 6);
        // bevel: light top edge, dark bottom edge
        ctx.fillStyle = grey(Math.min(255, v + 22));
        ctx.fillRect(x + 3, row * rh + 3, w - 6, 3);
        ctx.fillStyle = grey(v - 40);
        ctx.fillRect(x + 3, row * rh + rh - 6, w - 6, 3);
        if (x + w > 256) { // wrap the block around so the texture tiles
          ctx.fillStyle = grey(v);
          ctx.fillRect(x + 3 - 256, row * rh + 3, w - 6, rh - 6);
        }
        x += w;
      }
    }
    speckle(ctx, r, 256, 1800, 60, 255);
  });
}

/** Overlapping roof tiles (slate or clay); rows run along u. */
export function roofTex() {
  return canvasTex("roof", 256, (ctx, r) => {
    ctx.fillStyle = grey(70);
    ctx.fillRect(0, 0, 256, 256);
    const rows = 8, rh = 256 / rows, cols = 8, cw = 256 / cols;
    for (let row = 0; row < rows; row++) {
      for (let col = -1; col <= cols; col++) {
        const x = col * cw + (row % 2 ? cw / 2 : 0);
        const v = 175 + r() * 60;
        const g = ctx.createLinearGradient(0, row * rh, 0, row * rh + rh);
        g.addColorStop(0, grey(v - 45));
        g.addColorStop(1, grey(v));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x + 2, row * rh);
        ctx.lineTo(x + cw - 2, row * rh);
        ctx.lineTo(x + cw - 2, row * rh + rh - 6);
        ctx.quadraticCurveTo(x + cw / 2, row * rh + rh + 2, x + 2, row * rh + rh - 6);
        ctx.closePath();
        ctx.fill();
      }
    }
    speckle(ctx, r, 256, 900, 40, 255, 0.12);
  });
}

/** Vertical wooden planks with grain. */
export function plankTex() {
  return canvasTex("plank", 256, (ctx, r) => {
    const n = 8, pw = 256 / n;
    for (let i = 0; i < n; i++) {
      const v = 170 + r() * 55;
      ctx.fillStyle = grey(v);
      ctx.fillRect(i * pw, 0, pw, 256);
      ctx.strokeStyle = grey(v - 35);
      ctx.globalAlpha = 0.5;
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        const gx = i * pw + 4 + r() * (pw - 8);
        ctx.moveTo(gx, 0);
        ctx.bezierCurveTo(gx + (r() - 0.5) * 8, 80, gx + (r() - 0.5) * 8, 170, gx, 256);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = grey(60);
      ctx.fillRect(i * pw, 0, 2, 256);
    }
    speckle(ctx, r, 256, 500, 40, 200, 0.15);
  });
}

/** Rounded cobbles for yards, roads and district plates. */
export function cobbleTex() {
  return canvasTex("cobble", 256, (ctx, r) => {
    ctx.fillStyle = grey(110);
    ctx.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const x = col * 25.6 + (row % 2 ? 12.8 : 0) + (r() - 0.5) * 4;
        const y = row * 25.6 + (r() - 0.5) * 4;
        const v = 180 + r() * 60;
        for (const [ox, oy] of [[0, 0], [-256, 0], [0, -256], [256, 0], [0, 256]]) {
          ctx.fillStyle = grey(v);
          ctx.beginPath();
          ctx.ellipse(x + 12.8 + ox, y + 12.8 + oy, 10.5 + r() * 1.5, 9.5 + r() * 1.5, r() * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = grey(v + 25);
          ctx.beginPath();
          ctx.ellipse(x + 10 + ox, y + 9 + oy, 5, 3.5, 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
}

/** Soft ground noise for grass and dirt (multiplies vertex colours). */
export function groundTex() {
  return canvasTex("ground", 256, (ctx, r) => {
    ctx.fillStyle = grey(225);
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const x = r() * 256, y = r() * 256;
      ctx.strokeStyle = r() < 0.5 ? grey(255) : grey(165 + r() * 40);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4); // grass blade
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

// ---------- materials ----------

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export interface MatOpts { map?: THREE.Texture; emissive?: THREE.ColorRepresentation; emissiveIntensity?: number; rough?: number; metal?: number; flat?: boolean }
/** Shared material per colour and options (do not mutate the result; clone it to animate). */
export function mat(color: THREE.ColorRepresentation, o: MatOpts = {}) {
  const key = `${new THREE.Color(color).getHexString()}|${o.map?.uuid ?? ""}|${o.emissive ?? ""}|${o.emissiveIntensity ?? ""}|${o.rough ?? ""}|${o.metal ?? ""}|${o.flat ?? true}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, map: o.map ?? null, roughness: o.rough ?? 0.92, metalness: o.metal ?? 0, flatShading: o.flat ?? true,
    });
    if (o.emissive !== undefined) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
    matCache.set(key, m);
  }
  return m;
}

// ---------- geometry helpers ----------

/** Box-projected UVs in world units times `scale` (textures keep their size on any face). */
export function worldUV(geo: THREE.BufferGeometry, scale = 1) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Gable roof prism: width along x, depth along z, apex height h, overhang o; base at y = 0. */
export function gable(w: number, d: number, h: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

/** Roof slope slab (two tilted boxes) with an overhang, ridge along z. */
export function slabRoof(w: number, d: number, h: number, t = 0.07) {
  const half = w / 2;
  const len = Math.hypot(half, h) + 0.08;
  const ang = Math.atan2(h, half);
  const a = new THREE.BoxGeometry(len, t, d);
  a.translate(-len / 2 + 0.04, 0, 0);
  a.rotateZ(-ang);
  a.translate(0, h, 0);
  const b = a.clone();
  b.scale(-1, 1, 1);
  // Mirroring flips the winding; fix the index order so faces stay outward.
  const idx = b.index!;
  for (let i = 0; i < idx.count; i += 3) { const t0 = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t0); }
  b.computeVertexNormals();
  return mergeGeometries([a.toNonIndexed(), b.toNonIndexed()])!;
}

// ---------- builder ----------

type Bucket = { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

/**
 * Collects static parts and merges them per material. Parts are placed in the kit's local space:
 * add(geometry, material, [x, y, z], [rx, ry, rz], [sx, sy, sz]).
 */
export class Kit {
  private buckets = new Map<string, Bucket>();
  add(geo: THREE.BufferGeometry, material: THREE.Material, pos: number[] = [0, 0, 0], rot: number[] = [0, 0, 0], scale: number[] = [1, 1, 1], cast = true) {
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.set(scale[0], scale[1], scale[2]));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(_m);
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    g.morphAttributes = {};
    worldUV(g, 1);
    const key = material.uuid + (cast ? ":c" : ":n");
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { mat: material, cast, geos: [] }));
    b.geos.push(g);
    return this;
  }
  box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, ry = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), material, [x, y, z], [0, ry, 0]);
  }
  /** Merged meshes, one per material, into `into` (a new group when omitted). */
  build(into: THREE.Object3D = new THREE.Group()) {
    for (const b of this.buckets.values()) {
      const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
      if (b.geos.length > 1) b.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const m = new THREE.Mesh(merged, b.mat);
      m.castShadow = b.cast;
      m.receiveShadow = true;
      into.add(m);
    }
    this.buckets.clear();
    return into;
  }
}
