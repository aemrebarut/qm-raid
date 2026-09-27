// Small shared helpers for scene/: seeded random, material cache, sprite labels, tile coordinates.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Tile (x, y) to world position of the tile centre; y is up in world space. */
export const tileToWorld = (x: number, y: number, h = 0) => new THREE.Vector3(x + 0.5, h, y + 0.5);

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const matCache = new Map<string, THREE.MeshLambertMaterial>();
/** Shared flat-shaded material per colour (do not mutate the result). */
export function mat(color: THREE.ColorRepresentation, opts: { emissive?: THREE.ColorRepresentation; flat?: boolean } = {}) {
  const key = `${new THREE.Color(color).getHexString()}|${opts.emissive ?? ""}|${opts.flat ?? true}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: opts.flat ?? true });
    if (opts.emissive !== undefined) m.emissive = new THREE.Color(opts.emissive);
    matCache.set(key, m);
  }
  return m;
}

export function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** Gable roof prism: width along x, depth along z, apex height h; base at y = 0. */
export function gableRoof(w: number, d: number, h: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

export const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;

export interface LabelOpts {
  height?: number;      // world units
  color?: string;
  bg?: string | null;   // parchment by default
  border?: string;
  font?: number;        // px on the canvas
  bold?: boolean;
}

/** Text sprite anchored at its bottom centre, always drawn on top. */
export function makeLabel(text: string, o: LabelOpts = {}) {
  const font = o.font ?? 44;
  const pad = Math.round(font * 0.45);
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const fontStr = `${o.bold === false ? "" : "600 "}${font}px ${SERIF}`;
  ctx.font = fontStr;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = Math.ceil(font * 1.35) + pad;
  c.width = w;
  c.height = h;
  ctx.font = fontStr;
  if (o.bg !== null) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, o.bg ?? "#f1e3bf");
    g.addColorStop(1, o.bg ?? "#d9c393");
    ctx.fillStyle = g;
    roundRect(ctx, 2, 2, w - 4, h - 4, 8);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = o.border ?? "#6b4e2a";
    ctx.stroke();
  }
  ctx.fillStyle = o.color ?? "#2b1d0e";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (o.bg === null) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(text, w / 2, h / 2 + 1);
  }
  ctx.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sm = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
  const sp = new THREE.Sprite(sm);
  const hh = o.height ?? 0.5;
  sp.scale.set((hh * w) / h, hh, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 10;
  return sp;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Round icon bubble (for unit status), drawn on top. */
export function makeBubble(glyph: string, fg: string, bg: string, size = 0.42) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#2b1d0e";
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = `700 38px ${SERIF}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, 32, 35);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(size, size, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 11;
  return sp;
}

/** Procedural cobblestone texture (grey, tint with material colour). */
let cobbleTex: THREE.CanvasTexture | null = null;
export function cobbleTexture() {
  if (cobbleTex) return cobbleTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#8a8578";
  ctx.fillRect(0, 0, 128, 128);
  const r = rng(7);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const x = col * 16 + (row % 2 ? 8 : 0) + (r() - 0.5) * 2;
      const y = row * 16 + (r() - 0.5) * 2;
      const v = 190 + Math.floor(r() * 50);
      ctx.fillStyle = `rgb(${v},${v - 4},${v - 14})`;
      ctx.beginPath();
      ctx.ellipse(x + 8, y + 8, 6.5 + r(), 6 + r(), r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  cobbleTex = new THREE.CanvasTexture(c);
  cobbleTex.wrapS = cobbleTex.wrapT = THREE.RepeatWrapping;
  cobbleTex.colorSpace = THREE.SRGBColorSpace;
  return cobbleTex;
}

export function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const anyO = o as any;
    if (anyO.geometry && !anyO.geometry.userData?.shared) anyO.geometry.dispose?.();
    if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
}

/**
 * Merge static opaque meshes under root into one mesh per material (fewer draw calls).
 * Skips sprites, instanced meshes, textured or transparent materials, and anything with userData.keep.
 */
export function mergeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.userData.keep) return;
    for (let p = o.parent; p && p !== root; p = p.parent) if (p.userData.keep) return;
    const m = o.material as THREE.Material;
    if (Array.isArray(o.material) || (m as THREE.MeshLambertMaterial).map || m.transparent) return;
    const key = m.uuid + (o.castShadow ? ":c" : ":n");
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: m, cast: o.castShadow, geos: [], meshes: [] }));
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    g.morphAttributes = {};
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    b.geos.push(g);
    b.meshes.push(o);
  });
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) { b.geos.forEach((g) => g.dispose()); continue; }
    const merged = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    for (const m of b.meshes) m.parent?.remove(m);
    const mm = new THREE.Mesh(merged, b.mat);
    mm.castShadow = b.cast;
    mm.receiveShadow = true;
    root.add(mm);
  }
  return root;
}
