// Buildings: Library (GBrain stone monastery), Barracks (half-timbered hall), Forge (River smithy).
// Each model is centred on its origin, fits a 3 x 3 tile footprint (x, z in -1.45..1.45), front faces +z
// and +x (toward the camera), tall parts sit at the back. Model only: no labels, rings or game state.
import * as THREE from "three";
import type { BuildingArt, BuildingKind, BuildingOpts } from "../types";
import { Kit, cobbleTex, gable, mat, plankTex, roofTex, slabRoof, stoneTex } from "./kit";

export type { BuildingArt, BuildingKind, BuildingOpts };
type Model = Omit<BuildingArt, "dispose">;

/** Building team banners use this red unless the board recolours them (Barracks flags). */
const BANNER_RED = "#b8352b";

export function makeBuilding(kind: BuildingKind, _opts: BuildingOpts = {}): BuildingArt {
  const b = kind === "library" ? library() : kind === "barracks" ? barracks() : forge();
  b.object3d.name = `art:${kind}`;
  b.object3d.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
  return { ...b, dispose: () => disposeOwned(b.object3d) };
}

/** Frees geometries and per-building materials; cached kit materials and textures stay (shared). */
function disposeOwned(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const ms = Array.isArray(m.material) ? m.material : [m.material];
    for (const x of ms) if (x.userData.owned) x.dispose();
  });
}

// ---------- shared pieces ----------

const STONE = () => mat("#d6ccb8", { map: stoneTex() });
const STONE_DARK = () => mat("#a39a88", { map: stoneTex() });
const COBBLE = () => mat("#b3aa98", { map: cobbleTex() });
const PLANK = (c = "#7a5431") => mat(c, { map: plankTex() });
const TILES = (c: string) => mat(c, { map: roofTex() });

function glowMat(color: string, emissive: string, intensity = 1.4) {
  return owned(new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness: 0.4, flatShading: true }));
}
function owned<T extends THREE.Material>(m: T) { m.userData.owned = true; return m; }

/** Pointed (gothic) window or door on a face: `face` is the axis the wall faces (+x or +z). */
function lancet(kit: Kit, m: THREE.Material, face: "x" | "z", x: number, y: number, z: number, w: number, h: number, t = 0.04) {
  const d = w / Math.SQRT2;
  if (face === "z") {
    kit.box(w, h, t, m, x, y, z);
    kit.add(new THREE.BoxGeometry(d, d, t), m, [x, y + h / 2, z], [0, 0, Math.PI / 4]);
  } else {
    kit.box(t, h, w, m, x, y, z);
    kit.add(new THREE.BoxGeometry(t, d, d), m, [x, y + h / 2, z], [Math.PI / 4, 0, 0]);
  }
}

/** Crenellated parapet on a square top centred at (x, z), side s, at height y. */
function parapet(kit: Kit, m: THREE.Material, x: number, y: number, z: number, s: number) {
  kit.box(s, 0.1, s, m, x, y + 0.05, z);
  const n = 4, step = s / n, g = new THREE.BoxGeometry(step * 0.55, 0.14, step * 0.55);
  for (let i = 0; i < n; i++) {
    const o = -s / 2 + step * (i + 0.5);
    for (const [px, pz] of [[x + o, z - s / 2 + step * 0.28], [x + o, z + s / 2 - step * 0.28], [x - s / 2 + step * 0.28, z + o], [x + s / 2 - step * 0.28, z + o]]) {
      kit.add(g, m, [px, y + 0.17, pz]);
    }
  }
}

/** Canvas texture of the GBrain crest: a gold knowledge graph on a blue field (original design). */
let crestTex: THREE.CanvasTexture | null = null;
function crest() {
  if (crestTex) return crestTex;
  const c = document.createElement("canvas");
  c.width = 128; c.height = 192;
  const ctx = c.getContext("2d")!;
  // Banner cloth with a swallowtail
  const g = ctx.createLinearGradient(0, 0, 0, 192);
  g.addColorStop(0, "#2a5da8"); g.addColorStop(1, "#1a3a70");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(128, 0); ctx.lineTo(128, 192); ctx.lineTo(64, 160); ctx.lineTo(0, 192); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#e8c35a"; ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(8, 6); ctx.lineTo(120, 6); ctx.lineTo(120, 178); ctx.lineTo(64, 150); ctx.lineTo(8, 178); ctx.closePath();
  ctx.stroke();
  // Knowledge graph: a ring of nodes linked to a bright core
  const cx = 64, cy = 76, nodes: [number, number][] = [];
  for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI * 2; nodes.push([cx + Math.cos(a) * 34, cy + Math.sin(a) * 34]); }
  ctx.strokeStyle = "#f3d98a"; ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(nodes[i][0], nodes[i][1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nodes[i][0], nodes[i][1]); ctx.lineTo(nodes[(i + 2) % 6][0], nodes[(i + 2) % 6][1]); ctx.stroke();
  }
  ctx.fillStyle = "#ffe9a8";
  for (const [x, y] of nodes) { ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#fff6d8";
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
  crestTex = new THREE.CanvasTexture(c);
  crestTex.colorSpace = THREE.SRGBColorSpace;
  crestTex.anisotropy = 4;
  return crestTex;
}

/** Cloth banner that sways: returns the pivot to animate (rotation.x / rotation.y). */
function banner(map: THREE.Texture | null, color: THREE.ColorRepresentation, w: number, h: number) {
  const geo = new THREE.PlaneGeometry(w, h, 1, 4);
  geo.translate(0, -h / 2, 0);
  const m = owned(new THREE.MeshStandardMaterial({ color, map, side: THREE.DoubleSide, roughness: 0.85, emissive: map ? "#ffffff" : "#000000", emissiveMap: map, emissiveIntensity: map ? 0.25 : 0 }));
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  const pivot = new THREE.Group();
  pivot.add(mesh);
  return pivot;
}

function trees(kit: Kit, spots: [number, number, number][]) {
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.3, 5);
  const crown = new THREE.IcosahedronGeometry(0.22, 0);
  for (const [x, z, s] of spots) {
    kit.add(trunk, mat("#6b4a2b"), [x, 0.15 * s + 0.08, z], [0, 0, 0], [s, s, s]);
    kit.add(crown, mat("#5d8a34"), [x, 0.42 * s + 0.08, z], [0.3, x * 3, 0], [s, s * 1.1, s]);
  }
}

// ---------- Library ----------

function library(): Model {
  const root = new THREE.Group();
  const kit = new Kit();
  const stone = STONE(), stoneDark = STONE_DARK(), slate = TILES("#56688a"), wood = PLANK("#5a3a20");
  const win = glowMat("#bfe3ff", "#3d8fe8", 1.5);
  const Y0 = 0.08;

  // Cobbled close with a darker kerb
  kit.box(2.9, Y0, 2.9, COBBLE(), 0, Y0 / 2, 0);
  kit.box(2.94, 0.05, 2.94, stoneDark, 0, 0.025, 0);

  // Nave: ridge along z, gable facade facing +z
  const NX = -0.62, NZ = -0.22, NW = 1.2, ND = 1.9, NH = 1.05;
  kit.box(NW + 0.08, 0.16, ND + 0.08, stoneDark, NX, Y0 + 0.08, NZ);
  kit.box(NW, NH, ND, stone, NX, Y0 + NH / 2, NZ);
  kit.add(gable(NW, ND, 0.8), stone, [NX, Y0 + NH, NZ]);
  kit.add(slabRoof(NW + 0.22, ND + 0.14, 0.8), slate, [NX, Y0 + NH - 0.02, NZ]);
  kit.box(0.06, 0.06, ND + 0.16, mat("#3b4660"), NX, Y0 + NH + 0.83, NZ); // ridge cap
  // Facade: pointed door in a stone frame, rose window, a cross-gable finial
  const FZ = NZ + ND / 2;
  lancet(kit, stoneDark, "z", NX, Y0 + 0.32, FZ + 0.02, 0.46, 0.58, 0.05);
  lancet(kit, wood, "z", NX, Y0 + 0.3, FZ + 0.05, 0.32, 0.52, 0.03);
  kit.add(new THREE.TorusGeometry(0.2, 0.035, 6, 16), stoneDark, [NX, Y0 + NH + 0.22, FZ + 0.03]);
  const rose = new THREE.Mesh(new THREE.CircleGeometry(0.19, 16), win);
  rose.position.set(NX, Y0 + NH + 0.22, FZ + 0.025);
  root.add(rose);
  kit.add(new THREE.ConeGeometry(0.06, 0.22, 4), stoneDark, [NX, Y0 + NH + 0.92, FZ + 0.02]);
  // Steps before the door
  kit.box(0.6, 0.05, 0.22, stoneDark, NX, Y0 + 0.025, FZ + 0.14);
  // East side: buttresses between tall glowing lancets
  const EX = NX + NW / 2;
  for (const z of [NZ - 0.9, NZ - 0.3, NZ + 0.3, NZ + 0.9]) {
    kit.box(0.14, 0.78, 0.16, stoneDark, EX + 0.06, Y0 + 0.39, z);
    kit.add(new THREE.BoxGeometry(0.14, 0.2, 0.16), stoneDark, [EX + 0.03, Y0 + 0.82, z], [0, 0, 0.6]);
  }
  for (const z of [NZ - 0.6, NZ, NZ + 0.6]) lancet(kit, win, "x", EX + 0.012, Y0 + 0.55, z, 0.16, 0.42);
  // Front corners also buttressed
  for (const x of [NX - NW / 2, NX + NW / 2]) kit.box(0.16, 0.9, 0.14, stoneDark, x, Y0 + 0.45, FZ + 0.03);

  // Bell tower at the back right
  const TX = 0.55, TZ = -0.72, TS = 0.78, TH = 2.3;
  kit.box(TS + 0.08, 0.2, TS + 0.08, stoneDark, TX, Y0 + 0.1, TZ);
  kit.box(TS, TH, TS, stone, TX, Y0 + TH / 2, TZ);
  kit.box(TS + 0.06, 0.07, TS + 0.06, stoneDark, TX, Y0 + 1.35, TZ); // string course
  for (const dz of [-0.14, 0.14]) lancet(kit, win, "x", TX + TS / 2 + 0.012, Y0 + 1.8, TZ + dz, 0.13, 0.36);
  for (const dx of [-0.14, 0.14]) lancet(kit, win, "z", TX + dx, Y0 + 1.8, TZ + TS / 2 + 0.012, 0.13, 0.36);
  lancet(kit, win, "z", TX, Y0 + 0.85, TZ + TS / 2 + 0.012, 0.12, 0.3);
  parapet(kit, stoneDark, TX, Y0 + TH, TZ, TS + 0.12);
  kit.add(new THREE.ConeGeometry(0.46, 1.15, 4), slate, [TX, Y0 + TH + 0.2 + 0.575, TZ], [0, Math.PI / 4, 0]);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    kit.add(new THREE.ConeGeometry(0.06, 0.26, 4), slate, [TX + dx * 0.4, Y0 + TH + 0.36, TZ + dz * 0.4], [0, Math.PI / 4, 0]);
  }
  // Crest banner hanging on the tower front
  const crestBanner = banner(crest(), "#ffffff", 0.34, 0.52);
  crestBanner.position.set(TX, Y0 + 1.3, TZ + TS / 2 + 0.03);
  root.add(crestBanner);
  kit.box(0.44, 0.03, 0.03, wood, TX, Y0 + 1.31, TZ + TS / 2 + 0.03);

  // Scriptorium garden at the front right: low wall, hedges, lecterns, a tree
  const low = new THREE.BoxGeometry(1, 0.2, 0.12);
  kit.add(low, stoneDark, [0.72, Y0 + 0.1, 1.3], [0, 0, 0], [1.1, 1, 1]);
  kit.add(low, stoneDark, [1.3, Y0 + 0.1, 0.62], [0, Math.PI / 2, 0], [1.25, 1, 1]);
  const hedge = mat("#4f7a2c");
  kit.box(0.9, 0.16, 0.14, hedge, 0.72, Y0 + 0.08, 1.14);
  kit.box(0.14, 0.16, 1.0, hedge, 1.14, Y0 + 0.08, 0.6);
  for (const [x, z] of [[0.35, 0.62], [0.72, 0.5]]) {
    kit.box(0.05, 0.3, 0.05, wood, x, Y0 + 0.15, z);
    kit.add(new THREE.BoxGeometry(0.24, 0.03, 0.18), wood, [x, Y0 + 0.32, z], [0.35, 0, 0]);
    kit.add(new THREE.BoxGeometry(0.2, 0.02, 0.14), mat("#f1e6c8"), [x, Y0 + 0.345, z + 0.005], [0.35, 0, 0]);
  }
  trees(kit, [[0.95, 0.95, 1], [-1.3, 1.25, 0.8]]);
  kit.build(root);

  // Orb of knowledge above the spire: recall beams start here.
  const orbMat = owned(new THREE.MeshStandardMaterial({ color: "#9fd0ff", emissive: "#2f7fe0", emissiveIntensity: 1.6, roughness: 0.2, flatShading: true }));
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), orbMat);
  orb.name = "libraryOrb";
  const orbY = Y0 + TH + 1.62;
  orb.position.set(TX, orbY, TZ);
  root.add(orb);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.015, 4, 24), owned(new THREE.MeshBasicMaterial({ color: "#8fd0ff", transparent: true, opacity: 0.6 })));
  halo.position.copy(orb.position);
  halo.rotation.x = Math.PI / 2;
  root.add(halo);
  const light = new THREE.PointLight("#5aa9ff", 2.5, 4, 1.5);
  light.position.set(TX, orbY - 0.2, TZ);
  root.add(light);

  let pulseT = 0, lit = false;
  return {
    object3d: root, anchor: orb,
    door: new THREE.Vector3(NX, 0, FZ + 0.55),
    top: orb.position.clone(),
    tick(t, dt) {
      pulseT = Math.max(0, pulseT - dt);
      const p = pulseT > 0 ? Math.sin((pulseT / 0.9) * Math.PI) : 0;
      orb.position.y = orbY + Math.sin(t * 1.6) * 0.06;
      orb.rotation.y += dt * 0.8;
      orb.scale.setScalar(1 + p * 0.8);
      orbMat.emissiveIntensity = 1.6 + p * 3;
      halo.position.y = orb.position.y;
      halo.rotation.z += dt * 1.5;
      halo.scale.setScalar(1 + p * 1.5 + Math.sin(t * 2) * 0.05);
      win.emissiveIntensity = (lit ? 2.4 : 1.5) + Math.sin(t * 1.3) * 0.15 + p * 2.5;
      light.intensity = 2.5 + Math.sin(t * 2) * 0.3 + p * 10;
      crestBanner.rotation.x = Math.sin(t * 1.7) * 0.06 - 0.04;
    },
    pulse() { pulseT = 0.9; },
    glow(on) { lit = on; },
    setWork() {},
  };
}

// ---------- Barracks ----------

function barracks(): Model {
  const root = new THREE.Group();
  const kit = new Kit();
  const team = new THREE.Color(BANNER_RED);
  const stoneDark = STONE_DARK(), plaster = mat("#e8dcc0"), beam = PLANK("#4a2f18"), clay = TILES("#a8452f"), wood = PLANK("#8a5f36");
  const Y0 = 0.06;

  // Packed earth yard with a stone kerb
  kit.box(2.9, Y0, 2.9, mat("#a88a5c"), 0, Y0 / 2, 0);

  // Long hall along x at the back
  const HX = -0.15, HZ = -0.45, HW = 2.3, HD = 1.15, HH = 0.8;
  kit.box(HW + 0.06, 0.28, HD + 0.06, stoneDark, HX, Y0 + 0.14, HZ);
  kit.box(HW, HH - 0.28, HD, plaster, HX, Y0 + 0.28 + (HH - 0.28) / 2, HZ);
  // Half-timbering on the front (+z) and east (+x) faces: posts, rails, braces
  const FZ = HZ + HD / 2 + 0.012, EX = HX + HW / 2 + 0.012;
  for (let i = 0; i <= 6; i++) kit.box(0.07, HH - 0.28, 0.03, beam, HX - HW / 2 + (HW * i) / 6, Y0 + 0.28 + (HH - 0.28) / 2, FZ);
  kit.box(HW, 0.06, 0.035, beam, HX, Y0 + 0.3, FZ);
  kit.box(HW, 0.06, 0.035, beam, HX, Y0 + HH - 0.02, FZ);
  for (let i = 0; i < 6; i++) {
    if (i === 3) continue; // door bay
    const x = HX - HW / 2 + (HW * (i + 0.5)) / 6;
    kit.add(new THREE.BoxGeometry(0.05, 0.55, 0.03), beam, [x, Y0 + 0.28 + (HH - 0.28) / 2, FZ], [0, 0, i % 2 ? 0.6 : -0.6]);
  }
  for (let i = 0; i <= 3; i++) kit.box(0.03, HH - 0.28, 0.07, beam, EX, Y0 + 0.28 + (HH - 0.28) / 2, HZ - HD / 2 + (HD * i) / 3);
  kit.box(0.035, 0.06, HD, beam, EX, Y0 + HH - 0.02, HZ);
  // Upper storey jettied out, plaster and timber, under a steep clay roof (ridge along x)
  const UH = 0.42;
  kit.box(HW + 0.1, UH, HD + 0.12, plaster, HX, Y0 + HH + UH / 2, HZ);
  for (let i = 0; i <= 8; i++) kit.box(0.06, UH, 0.03, beam, HX - (HW + 0.1) / 2 + ((HW + 0.1) * i) / 8, Y0 + HH + UH / 2, HZ + (HD + 0.12) / 2 + 0.012);
  kit.box(HW + 0.14, 0.07, HD + 0.16, beam, HX, Y0 + HH + 0.02, HZ);
  const roofGeo = slabRoof(HD + 0.34, HW + 0.3, 0.75);
  kit.add(gable(HD + 0.12, HW + 0.1, 0.75), plaster, [HX, Y0 + HH + UH, HZ], [0, Math.PI / 2, 0]);
  kit.add(roofGeo, clay, [HX, Y0 + HH + UH - 0.02, HZ], [0, Math.PI / 2, 0]);
  kit.box(HW + 0.32, 0.06, 0.06, mat("#6a2a1c"), HX, Y0 + HH + UH + 0.77, HZ);
  // Dormer windows glowing warm, ground floor windows with shutters
  const warm = glowMat("#ffe0a0", "#ff9c3a", 0.9);
  for (const x of [HX - 0.75, HX - 0.25, HX + 0.65]) {
    kit.box(0.16, 0.18, 0.02, warm, x, Y0 + 0.55, FZ + 0.012);
    kit.box(0.06, 0.2, 0.02, mat("#2f4a2a"), x - 0.12, Y0 + 0.55, FZ + 0.02);
    kit.box(0.06, 0.2, 0.02, mat("#2f4a2a"), x + 0.12, Y0 + 0.55, FZ + 0.02);
  }
  for (const x of [HX - 0.6, HX + 0.3]) kit.box(0.14, 0.16, 0.02, warm, x, Y0 + HH + 0.2, HZ + (HD + 0.12) / 2 + 0.02);
  // Big double door with a stone step
  kit.box(0.44, 0.46, 0.03, wood, HX + 0.1, Y0 + 0.23 + 0.02, FZ + 0.02);
  kit.box(0.03, 0.46, 0.035, beam, HX + 0.1, Y0 + 0.25, FZ + 0.035);
  kit.box(0.56, 0.05, 0.2, stoneDark, HX + 0.1, Y0 + 0.025, FZ + 0.1);
  // Chimney
  kit.box(0.22, 1.9, 0.22, stoneDark, HX - 0.9, Y0 + 0.95, HZ - 0.3);

  // Training yard at the front: fence, dummy, weapon rack, archery butt
  const post = new THREE.BoxGeometry(0.05, 0.28, 0.05), rail = new THREE.BoxGeometry(1, 0.035, 0.03);
  for (let i = 0; i <= 5; i++) kit.add(post, wood, [-1.35 + i * 0.5, Y0 + 0.14, 1.36]);
  for (const y of [0.1, 0.22]) kit.add(rail, wood, [-0.1, Y0 + y, 1.36], [0, 0, 0], [2.5, 1, 1]);
  for (let i = 0; i <= 3; i++) kit.add(post, wood, [1.36, Y0 + 0.14, 1.36 - i * 0.45]);
  for (const y of [0.1, 0.22]) kit.add(rail, wood, [1.36, Y0 + y, 0.68], [0, Math.PI / 2, 0], [1.35, 1, 1]);
  // Dummy
  kit.box(0.05, 0.5, 0.05, beam, -0.85, Y0 + 0.25, 0.75);
  kit.box(0.34, 0.04, 0.04, beam, -0.85, Y0 + 0.42, 0.75);
  kit.add(new THREE.CylinderGeometry(0.09, 0.08, 0.22, 6), mat("#c9ab6e"), [-0.85, Y0 + 0.36, 0.75]);
  kit.add(new THREE.SphereGeometry(0.08, 6, 5), mat("#c9ab6e"), [-0.85, Y0 + 0.55, 0.75]);
  // Weapon rack
  kit.box(0.5, 0.04, 0.05, beam, 0.75, Y0 + 0.4, 0.55);
  for (const x of [0.52, 0.98]) kit.box(0.04, 0.42, 0.04, beam, x, Y0 + 0.21, 0.55);
  for (let i = 0; i < 4; i++) {
    kit.add(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4), mat("#6d5a44"), [0.58 + i * 0.11, Y0 + 0.3, 0.6], [0.2, 0, 0]);
    kit.add(new THREE.ConeGeometry(0.025, 0.08, 4), mat("#b8bcc4", { metal: 0.6, rough: 0.4 }), [0.58 + i * 0.11, Y0 + 0.63, 0.66], [0.2, 0, 0]);
  }
  // Archery butt
  kit.add(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 12), mat("#d9c07a"), [0.2, Y0 + 0.3, 0.95], [Math.PI / 2 - 0.25, 0, 0]);
  kit.add(new THREE.CylinderGeometry(0.1, 0.1, 0.085, 12), mat("#b8352b"), [0.2, Y0 + 0.3, 0.955], [Math.PI / 2 - 0.25, 0, 0]);
  kit.box(0.04, 0.35, 0.04, beam, 0.2, Y0 + 0.14, 0.86);
  // Barrels and crates by the wall
  const barrel = new THREE.CylinderGeometry(0.09, 0.09, 0.2, 8);
  for (const [x, z] of [[1.25, -0.2], [1.25, 0.02], [1.08, -0.1]]) kit.add(barrel, wood, [x, Y0 + 0.1, z]);
  kit.box(0.2, 0.2, 0.2, wood, -1.3, Y0 + 0.1, 0.35);
  kit.box(0.16, 0.16, 0.16, wood, -1.27, Y0 + 0.28, 0.33, 0.4);
  kit.build(root);

  // Two banners in team colour on poles flanking the door, swaying
  const poleGeo = new THREE.CylinderGeometry(0.022, 0.022, 1.5, 5);
  const flags: THREE.Group[] = [];
  for (const x of [HX - 0.35, HX + 0.55]) {
    const pole = new THREE.Mesh(poleGeo, mat("#4a2f18"));
    pole.position.set(x, Y0 + 0.75, FZ + 0.28);
    pole.castShadow = true;
    root.add(pole);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), mat("#e8c35a", { metal: 0.6, rough: 0.35 }));
    knob.position.set(x, Y0 + 1.52, FZ + 0.28);
    root.add(knob);
    const f = banner(null, team, 0.26, 0.5);
    f.position.set(x + 0.02, Y0 + 1.45, FZ + 0.28);
    f.rotation.y = Math.PI / 2;
    flags.push(f);
    root.add(f);
  }

  let pulseT = 0, lit = false;
  return {
    object3d: root, anchor: root,
    door: new THREE.Vector3(HX + 0.1, 0, 1.7),
    top: new THREE.Vector3(HX - 0.9, Y0 + 1.95, HZ - 0.3),
    tick(t, dt) {
      pulseT = Math.max(0, pulseT - dt);
      flags.forEach((f, i) => { f.rotation.x = Math.sin(t * 2.1 + i) * 0.12; f.rotation.y = Math.PI / 2 + Math.sin(t * 1.3 + i * 2) * 0.25; });
      const p = pulseT > 0 ? Math.sin((pulseT / 0.5) * Math.PI) : 0;
      warm.emissiveIntensity = (lit ? 1.6 : 0.9) + p * 2;
      root.scale.y = 1 + p * 0.04;
    },
    pulse() { pulseT = 0.5; },
    glow(on) { lit = on; },
    setWork() {},
  };
}

// ---------- Forge ----------

function forge(): Model {
  const root = new THREE.Group();
  const kit = new Kit();
  const stone = mat("#9d9486", { map: stoneTex() }), stoneDark = mat("#6d665d", { map: stoneTex() });
  const roofM = TILES("#6b4630"), wood = PLANK("#6b4a2b"), iron = mat("#3c3c42", { metal: 0.5, rough: 0.5 });
  const Y0 = 0.06;
  kit.box(2.9, Y0, 2.9, mat("#8a7a62"), 0, Y0 / 2, 0);

  // Stone smithy along x, steep roof, big chimney at the back
  const SX = -0.3, SZ = -0.4, SW = 1.9, SD = 1.2, SH = 0.85;
  kit.box(SW, SH, SD, stone, SX, Y0 + SH / 2, SZ);
  kit.add(gable(SD, SW, 0.7), stone, [SX, Y0 + SH, SZ], [0, Math.PI / 2, 0]);
  kit.add(slabRoof(SD + 0.24, SW + 0.2, 0.7), roofM, [SX, Y0 + SH - 0.02, SZ], [0, Math.PI / 2, 0]);
  const CX = 0.55, CZ = -0.75;
  kit.box(0.5, 2.3, 0.5, stoneDark, CX, Y0 + 1.15, CZ);
  kit.box(0.58, 0.1, 0.58, stoneDark, CX, Y0 + 2.3, CZ);
  const ember = glowMat("#ffb35c", "#ff5a00", 2.2);
  kit.box(0.38, 0.04, 0.38, ember, CX, Y0 + 2.36, CZ);
  // Open-fronted work shed on the +z side, lean-to roof on posts
  for (const x of [SX - SW / 2 + 0.05, SX, SX + SW / 2 - 0.05]) kit.box(0.08, 0.72, 0.08, wood, x, Y0 + 0.36, SZ + SD / 2 + 0.62);
  kit.add(new THREE.BoxGeometry(SW + 0.1, 0.06, 0.8), roofM, [SX, Y0 + 0.8, SZ + SD / 2 + 0.36], [0.32, 0, 0]);
  // Furnace: stone hearth with a glowing mouth
  kit.box(0.6, 0.5, 0.36, stoneDark, SX + 0.45, Y0 + 0.25, SZ + SD / 2 + 0.18);
  const fireMat = glowMat("#ffc070", "#ff5a00", 2.5);
  kit.box(0.34, 0.2, 0.02, fireMat, SX + 0.45, Y0 + 0.22, SZ + SD / 2 + 0.37);
  // Anvil on a stump, quench trough with River-blue glowing water, tools on the wall
  const AX = SX - 0.35, AZ = SZ + SD / 2 + 0.4;
  kit.add(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 7), wood, [AX, Y0 + 0.1, AZ]);
  kit.box(0.1, 0.1, 0.1, iron, AX, Y0 + 0.25, AZ);
  kit.box(0.3, 0.07, 0.12, iron, AX, Y0 + 0.33, AZ);
  kit.add(new THREE.ConeGeometry(0.05, 0.12, 4), iron, [AX + 0.2, Y0 + 0.33, AZ], [0, 0, -Math.PI / 2]);
  const river = glowMat("#6fd0ff", "#1b8fe0", 1.4);
  kit.box(0.56, 0.16, 0.26, wood, SX - 0.95, Y0 + 0.08, SZ + SD / 2 + 0.25);
  kit.box(0.5, 0.02, 0.2, river, SX - 0.95, Y0 + 0.16, SZ + SD / 2 + 0.25);
  for (let i = 0; i < 3; i++) kit.box(0.03, 0.2, 0.02, iron, SX - 0.5 + i * 0.12, Y0 + 0.6, SZ + SD / 2 + 0.012);
  // River runes on the front wall: glowing blue glyph stones
  for (const x of [SX - 0.75, SX + 0.85]) {
    kit.box(0.12, 0.16, 0.02, river, x, Y0 + 0.62, SZ + SD / 2 + 0.012);
  }
  // Mill race on the east side: a channel of glowing River water turning a water wheel
  const WX = 1.15, WZ = -0.2;
  kit.box(0.3, 0.1, 2.6, stoneDark, WX + 0.02, Y0 + 0.05, 0);
  kit.box(0.2, 0.02, 2.6, river, WX + 0.02, Y0 + 0.1, 0);
  kit.box(0.04, 0.5, 0.04, wood, WX - 0.12, Y0 + 0.25, WZ);
  // Iron ingots and coal pile
  kit.add(new THREE.DodecahedronGeometry(0.16, 0), mat("#26262a"), [SX - 1.05, Y0 + 0.06, SZ + SD / 2 + 0.75], [0, 0, 0], [1.2, 0.5, 1]);
  for (let i = 0; i < 3; i++) kit.box(0.14, 0.05, 0.06, mat("#8a8e96", { metal: 0.7, rough: 0.35 }), SX + 0.2, Y0 + 0.03 + i * 0.05, SZ + SD / 2 + 0.85 + (i % 2) * 0.02, 0.2 * i);
  kit.build(root);

  // Water wheel (animated)
  const wheel = new THREE.Group();
  const wk = new Kit();
  wk.add(new THREE.TorusGeometry(0.4, 0.035, 5, 14), wood, [0, 0, 0], [0, Math.PI / 2, 0]);
  wk.add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8), iron, [0, 0, 0], [0, 0, Math.PI / 2]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    wk.add(new THREE.BoxGeometry(0.03, 0.8, 0.03), wood, [0, 0, 0], [a, 0, 0]);
    wk.add(new THREE.BoxGeometry(0.16, 0.12, 0.03), wood, [0, Math.cos(a) * 0.42, Math.sin(a) * 0.42], [a, 0, 0]);
  }
  wk.build(wheel);
  wheel.position.set(WX + 0.02, Y0 + 0.36, WZ);
  root.add(wheel);

  // Fire light and smoke
  const fire = new THREE.PointLight("#ff7a1a", 5, 4, 1.4);
  fire.position.set(SX + 0.45, Y0 + 0.5, SZ + SD / 2 + 0.7);
  root.add(fire);
  const puffGeo = new THREE.IcosahedronGeometry(0.14, 0);
  const puffs: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(puffGeo, owned(new THREE.MeshStandardMaterial({ color: "#8f8a85", transparent: true, opacity: 0.6, depthWrite: false, flatShading: true })));
    m.userData.phase = i / 7;
    puffs.push(m);
    root.add(m);
  }

  let pulseT = 0, work = 0, lit = false;
  const top = new THREE.Vector3(CX, Y0 + 2.4, CZ);
  return {
    object3d: root, anchor: fire,
    door: new THREE.Vector3(SX, 0, 1.7),
    top,
    tick(t, dt) {
      pulseT = Math.max(0, pulseT - dt);
      const p = pulseT > 0 ? Math.sin((pulseT / 1.2) * Math.PI) : 0;
      const w = work > 0 || lit ? 1 : 0;
      fire.intensity = 4 + w * 5 + Math.sin(t * (13 + w * 10)) * (0.8 + w) + Math.sin(t * 7.3) * 0.7 + p * 12;
      fireMat.emissiveIntensity = 2.2 + Math.sin(t * 11) * 0.3 + w + p * 2;
      ember.emissiveIntensity = 2 + Math.sin(t * 5) * 0.4 + w;
      river.emissiveIntensity = 1.2 + Math.sin(t * 2.2) * 0.25 + w * 0.8 + p * 2;
      wheel.rotation.x -= dt * (0.8 + w * 2.2);
      for (const m of puffs) {
        const ph = (t * (0.3 + w * 0.2) + m.userData.phase) % 1;
        m.position.set(top.x + Math.sin(ph * 5 + m.userData.phase * 9) * 0.12 - ph * 0.35, top.y + ph * 1.6, top.z - ph * 0.25);
        m.scale.setScalar(0.5 + ph * 1.8);
        (m.material as THREE.MeshStandardMaterial).opacity = (w ? 0.75 : 0.5) * (1 - ph);
      }
    },
    pulse() { pulseT = 1.2; },
    glow(on) { lit = on; },
    setWork(progress) { work = progress == null ? 0 : Math.max(0.01, progress); },
  };
}
