// Showroom: lays every exhibit from showroom/exhibits/*.ts out on a grid, turntables them, and shows
// their action buttons. Missing or broken exhibit files never break the page (each loads on its own).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Exhibit, ExhibitInstance, Lighting } from "../src/types";

const params = new URLSearchParams(location.search);
const onlyArea = params.get("area");
const focusName = params.get("focus");
const boardView = params.get("board") === "1";

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); // preserve: screenshots
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#2c3d1e");

// Board camera: orthographic, 30 deg elevation, 45 deg azimuth, camera at +x +z (same as apps/board).
const VIEW_H = 9;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const ELEV = THREE.MathUtils.degToRad(30), AZIM = THREE.MathUtils.degToRad(45), DIST = 60; // board DIST (fog is tuned to it)
const isoOffset = new THREE.Vector3(DIST * Math.cos(ELEV) * Math.sin(AZIM), DIST * Math.sin(ELEV), DIST * Math.cos(ELEV) * Math.cos(AZIM));
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  const a = w / h;
  camera.left = (-VIEW_H * a) / 2; camera.right = (VIEW_H * a) / 2;
  camera.top = VIEW_H / 2; camera.bottom = -VIEW_H / 2;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

function lookAt(p: THREE.Vector3, zoom?: number) {
  controls.target.copy(p);
  camera.position.copy(p).add(isoOffset);
  if (zoom) camera.zoom = zoom;
  camera.updateProjectionMatrix();
  controls.update();
}

// ---- lighting: the art lighting rig if it exists, else a plain default ----
const lightingMods = import.meta.glob("../src/lighting.ts", { eager: true }) as Record<string, { lighting?: (s: THREE.Scene, r: THREE.WebGLRenderer, o?: object) => Lighting }>;
const lightingFn = Object.values(lightingMods)[0]?.lighting;
let rig: Lighting | null = null;
try { rig = lightingFn ? lightingFn(scene, renderer, { mapSize: 24 }) : null; } catch (e) { console.error("[showroom] lighting failed", e); }
if (rig && typeof rig.update !== "function") { console.error("[showroom] lighting() handle has no update(); see Lighting in src/types.ts"); }
let rigUpdate = rig && typeof rig.update === "function" ? () => rig!.update() : null;
if (!rig) {
  scene.add(new THREE.HemisphereLight("#fff3d6", "#4a6630", 1.4));
  const sun = new THREE.DirectionalLight("#fff0cf", 2.4);
  sun.position.set(-10, 20, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 80 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
}

// ---- exhibits ----
const mods = import.meta.glob("./exhibits/*.ts");
interface Placed { ex: Exhibit; inst: ExhibitInstance; pivot: THREE.Group; center: THREE.Vector3 }
const placed: Placed[] = [];
const list = document.getElementById("list")!;
const AREAS = ["units", "monsters", "world", "fx", "lighting"] as const;
const groups = new Map<string, HTMLElement>();
for (const a of AREAS) {
  const h = document.createElement("h2");
  h.textContent = a;
  const box = document.createElement("div");
  list.append(h, box);
  groups.set(a, box);
}

const ground = new THREE.Group();
scene.add(ground);
const tileMat = new THREE.MeshLambertMaterial({ color: "#5d7f3a" });
const lineMat = new THREE.LineBasicMaterial({ color: "#48652b", transparent: true, opacity: 0.6 });

/**
 * Screen-aligned layout for the iso camera: one row per area running screen right (ground (1, 0, -1)),
 * rows stacked screen down (ground (1, 0, 1)). Big exhibits (span > 6) get a row of their own.
 */
const R = new THREE.Vector3(1, 0, -1).normalize(), D = new THREE.Vector3(1, 0, 1).normalize();
function layout(exs: Exhibit[]) {
  const rows: Exhibit[][] = [];
  for (const a of AREAS) {
    const small = exs.filter((e) => e.area === a && (e.span ?? 3) <= 6);
    const big = exs.filter((e) => e.area === a && (e.span ?? 3) > 6);
    if (small.length) rows.push(small);
    for (const b of big) rows.push([b]);
  }
  const out = new Map<Exhibit, THREE.Vector3>();
  let v = 0, prevMax = 0;
  for (const row of rows) {
    const max = Math.max(...row.map((e) => e.span ?? 3));
    v += (prevMax + max) * Math.SQRT1_2 + (prevMax ? 1.5 : 0);
    prevMax = max;
    let u = 0, prev = 0;
    for (const e of row) {
      const sp = e.span ?? 3;
      u += (prev + sp) * Math.SQRT1_2 + (prev ? 0.6 : 0);
      prev = sp;
      out.set(e, R.clone().multiplyScalar(u).addScaledVector(D, v));
    }
  }
  return out;
}

function cellGround(c: THREE.Vector3, span: number) {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(span, 0.1, span), tileMat);
  plate.position.set(c.x, -0.05, c.z);
  plate.receiveShadow = true;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= span; i++) {
    const o = i - span / 2;
    pts.push(new THREE.Vector3(c.x + o, 0.002, c.z - span / 2), new THREE.Vector3(c.x + o, 0.002, c.z + span / 2));
    pts.push(new THREE.Vector3(c.x - span / 2, 0.002, c.z + o), new THREE.Vector3(c.x + span / 2, 0.002, c.z + o));
  }
  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
  ground.add(plate, grid);
}

/** Board budgets agreed with raid-ui-scene (draw calls per instance). */
const BUDGET: Record<string, number> = { units: 12, monsters: 12, world: 40 };
function drawCalls(o: THREE.Object3D) {
  let n = 0;
  o.traverseVisible((c) => {
    const m = c as THREE.Mesh;
    if ((m.isMesh || (c as THREE.Points).isPoints || (c as THREE.Line).isLine || (c as THREE.Sprite).isSprite) && m.material)
      n += Array.isArray(m.material) ? m.material.length : 1;
  });
  return n;
}

function addRow(ex: Exhibit, err?: string, p?: Placed) {
  const box = groups.get(ex.area) ?? groups.get("fx")!;
  const d = document.createElement("div");
  d.className = "ex" + (err ? " err" : "");
  const n = document.createElement("div");
  n.className = "name";
  n.textContent = ex.name;
  n.onclick = () => p && lookAt(p.center, 2.2);
  d.appendChild(n);
  if (p) {
    const calls = drawCalls(p.inst.object3d);
    const budget = ex.span && ex.span > 6 ? undefined : BUDGET[ex.area];
    const c = document.createElement("span");
    c.className = "calls" + (budget && calls > budget ? " over" : "");
    c.textContent = ` ${calls} draws${budget ? ` / ${budget}` : ""}`;
    c.title = "draw calls of this exhibit (board budget per instance)";
    n.appendChild(c);
  }
  if (err) {
    const m = document.createElement("div");
    m.className = "msg";
    m.textContent = err;
    d.appendChild(m);
  }
  for (const [label, fn] of Object.entries(p?.inst.actions ?? {})) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => { try { fn(); } catch (e) { console.error(`[showroom] ${ex.name}.${label}`, e); } };
    d.appendChild(b);
  }
  box.appendChild(d);
}

/** Frame every exhibit: project the bounds into the camera, zoom to fit the area right of the sidebar. */
function fitAll() {
  const box = new THREE.Box3();
  // cells, not object bounds (particle pools and beams have huge or stale bounds)
  for (const p of placed) {
    const h = (p.ex.span ?? 3) / 2;
    box.expandByPoint(p.center.clone().add(new THREE.Vector3(-h, 0, -h))).expandByPoint(p.center.clone().add(new THREE.Vector3(h, Math.min(h * 1.6, 3), h)));
  }
  const c = box.getCenter(new THREE.Vector3()).setY(0);
  lookAt(c, 1);
  camera.updateMatrixWorld();
  const v = new THREE.Vector3(), lo = new THREE.Vector2(Infinity, Infinity), hi = new THREE.Vector2(-Infinity, -Infinity);
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(camera.matrixWorldInverse);
    lo.min(new THREE.Vector2(v.x, v.y)); hi.max(new THREE.Vector2(v.x, v.y));
  }
  const W = window.innerWidth, a = W / window.innerHeight, side = Math.min(300, W * 0.3);
  const zoom = Math.min((VIEW_H * a * ((W - side) / W) * 0.92) / (hi.x - lo.x), (VIEW_H * 0.9) / (hi.y - lo.y), 3);
  // centre the bounds in the area right of the sidebar
  const midX = (lo.x + hi.x) / 2, midY = (lo.y + hi.y) / 2;
  const shiftX = midX - ((side / 2) / W) * ((VIEW_H * a) / zoom);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  lookAt(c.clone().addScaledVector(right, shiftX).addScaledVector(up, midY), zoom);
}

async function load() {
  const all: Exhibit[] = [];
  for (const path of Object.keys(mods).sort()) {
    try { all.push(...(((await mods[path]()) as { default: Exhibit[] }).default ?? [])); }
    catch (e) {
      console.error(`[showroom] ${path} failed to load`, e);
      addRow({ name: path.replace("./exhibits/", ""), area: "fx", make: () => ({ object3d: new THREE.Group() }) }, String(e));
    }
  }
  const exs = all.filter((ex) => !onlyArea || ex.area === onlyArea);
  const at = layout(exs);
  for (const ex of exs) {
    const span = ex.span ?? 3;
    const center = at.get(ex)!;
    try {
      const pivot = new THREE.Group();
      pivot.position.copy(center);
      const inst = ex.make({ scene, renderer, origin: center.clone() });
      pivot.add(inst.object3d);
      scene.add(pivot);
      cellGround(center, span);
      const p = { ex, inst, pivot, center };
      placed.push(p);
      addRow(ex, undefined, p);
    } catch (e) {
      console.error(`[showroom] ${ex.name} failed`, e);
      addRow(ex, String(e));
    }
  }
  const f = focusName ? placed.find((p) => p.ex.name.toLowerCase() === focusName.toLowerCase()) : undefined;
  if (f) lookAt(f.center, 2.4);
  else if (placed.length) fitAll();
  else lookAt(new THREE.Vector3(), 1);
  (window as any).showroom = { placed, scene, camera, renderer, lookAt };
}
load();

// ---- loop ----
const turn = document.getElementById("turn") as HTMLInputElement;
const iso = document.getElementById("iso") as HTMLInputElement;
if (boardView) { turn.checked = false; iso.checked = true; }
iso.onchange = () => { controls.enableRotate = !iso.checked; if (iso.checked) lookAt(controls.target.clone()); };
controls.enableRotate = !iso.checked;
const stats = document.getElementById("stats")!;
const clock = new THREE.Clock();
let frames = 0, acc = 0, fps = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  for (const p of placed) {
    if (turn.checked && p.ex.turntable !== false) p.pivot.rotation.y += dt * 0.35;
    try { p.inst.tick?.(t, dt); } catch (e) { console.error(`[showroom] ${p.ex.name}.tick`, e); p.inst.tick = undefined; }
  }
  if (rigUpdate) {
    try { rigUpdate(); } catch (e) { console.error("[showroom] lighting update", e); rigUpdate = null; } // never blank the page
  }
  controls.update();
  renderer.render(scene, camera);
  frames++; acc += dt;
  if (acc >= 0.5) {
    fps = Math.round(frames / acc); frames = 0; acc = 0;
    const i = renderer.info.render;
    stats.textContent = `${fps} fps  ${i.calls} draws  ${(i.triangles / 1000).toFixed(1)}k tris  ${placed.length} exhibits`;
  }
});
