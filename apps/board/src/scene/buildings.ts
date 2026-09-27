// Buildings: the Library (GBrain, stone monastery), the Barracks (timber), the Forge (River smithy with a furnace).
// Each is built around its tile centre and covers a 3 x 3 footprint.
import * as THREE from "three";
import type { Building } from "../core";
import { makeBuilding } from "../../../../packages/art/src";
import { artOn } from "./art";
import { gableRoof, makeLabel, mat, mergeStatic, mesh, tileToWorld } from "./util";

const ART_KIND = { gbrain: "library", barracks: "barracks", river: "forge" } as const;

export interface BuildingView {
  id: string;
  kind: Building["kind"];
  group: THREE.Group;
  /** Anchor points for animations (world space), e.g. the Library orb. */
  anchor: THREE.Object3D;
  tick(t: number, dt: number): void;
  setSelected(on: boolean): void;
  setHovered(on: boolean): void;
  /** Short pulse (Library on remember, Forge on spawn). */
  pulse(): void;
  /** World point in front of the door, where spawned units appear. */
  door: THREE.Vector3;
  /** World point at the chimney or spire top (effects). */
  top: THREE.Vector3;
  /** Forge only: show work in progress (0..1) with a stage label, or null when idle. */
  setWork(progress: number | null, label?: string): void;
}

export function buildBuilding(b: Building): BuildingView {
  const group = new THREE.Group();
  group.position.copy(tileToWorld(b.x, b.y));
  group.userData = { kind: "building", id: b.id };
  group.name = `building:${b.id}`;

  // Selection ring shared by all buildings (placeholders also get a stone platform).
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.05, 2.2, 48),
    new THREE.MeshBasicMaterial({ color: "#f2e27a", transparent: true, opacity: 0.9, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  group.add(ring);

  let view: Omit<BuildingView, "setSelected" | "setHovered" | "group" | "id" | "kind" | "door" | "top" | "setWork"> & { setWork?: BuildingView["setWork"]; top?: THREE.Vector3; door?: THREE.Vector3; glow?: (on: boolean) => void };
  if (artOn("buildings")) view = artBuilding(group, b.kind);
  else {
    group.add(mesh(new THREE.BoxGeometry(2.9, 0.1, 2.9), mat("#8f887b"), 0, 0.05, 0, false));
    if (b.kind === "gbrain") view = library(group);
    else if (b.kind === "river") view = forge(group);
    else view = barracks(group);
    mergeStatic(group);
  }

  let selected = false, hovered = false;
  const syncRing = () => {
    ring.visible = selected || hovered;
    (ring.material as THREE.MeshBasicMaterial).opacity = selected ? 0.9 : 0.4;
    view.glow?.(selected || hovered);
  };
  return {
    setWork: () => {},
    ...view,
    // World-space points go after the spread: view.top is local to the building.
    id: b.id,
    kind: b.kind,
    group,
    door: group.position.clone().add(view.door ?? new THREE.Vector3(0.1, 0, 1.7)),
    top: group.position.clone().add(view.top ?? new THREE.Vector3(0, 2, 0)),
    setSelected(on) { selected = on; syncRing(); },
    setHovered(on) { hovered = on; syncRing(); },
  };
}

/** packages/art model in place of the placeholder (flag 'buildings'); the board keeps ring, label, banner and picking. */
function artBuilding(group: THREE.Group, kind: Building["kind"]) {
  const a = makeBuilding(ART_KIND[kind]);
  a.object3d.userData.keep = true; // already merged per material; never mergeStatic it
  group.add(a.object3d);
  const labelY = a.top.y + 0.55;
  if (kind === "gbrain") title(group, "Library", "GBrain", 2.7, -0.4, 0.4); // over the hall, below the orb and beams
  else if (kind === "river") title(group, "Forge", "River", labelY);
  else title(group, "Barracks", "spawn agents", labelY);
  const banner = kind === "river" ? workBanner(group, labelY + 0.55) : null;
  return {
    anchor: a.anchor,
    top: a.top.clone(),
    door: a.door.clone(),
    tick: (t: number, dt: number) => a.tick(t, dt),
    pulse: () => a.pulse(),
    glow: (on: boolean) => a.glow(on),
    setWork(progress: number | null, label = "") { a.setWork(progress); banner?.set(progress, label); },
  };
}

function title(group: THREE.Group, name: string, sub: string, y: number, x = 0, z = 0) {
  const l = makeLabel(`${name} · ${sub}`, { height: 0.42 });
  l.position.set(x, y, z);
  group.add(l);
}

function library(group: THREE.Group) {
  const stone = mat("#d9d0bd"), stoneDark = mat("#b3a994"), slate = mat("#46597a"), wood = mat("#4b3320");
  const glow = new THREE.MeshLambertMaterial({ color: "#7fc6ff", emissive: "#2f86d6" });
  // Main hall along x
  group.add(mesh(new THREE.BoxGeometry(2.1, 1.0, 1.3), stone, -0.25, 0.6, 0.35));
  const roof = mesh(gableRoof(1.55, 2.3, 0.7), slate, -0.25, 1.1, 0.35);
  roof.rotation.y = Math.PI / 2;
  group.add(roof);
  // Buttresses
  for (const x of [-1.1, -0.45, 0.2, 0.75]) group.add(mesh(new THREE.BoxGeometry(0.14, 0.7, 0.16), stoneDark, x, 0.45, 1.05));
  // Door and rose window on the south face
  group.add(mesh(new THREE.BoxGeometry(0.34, 0.5, 0.04), wood, -0.25, 0.35, 1.01));
  const rose = mesh(new THREE.CircleGeometry(0.17, 16), glow, -0.25, 0.83, 1.012, false);
  group.add(rose);
  // Bell tower
  group.add(mesh(new THREE.BoxGeometry(0.8, 2.0, 0.8), stone, 0.85, 1.1, -0.55));
  group.add(mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), stoneDark, 0.85, 2.1, -0.55));
  const spire = mesh(new THREE.ConeGeometry(0.64, 1.0, 4), slate, 0.85, 2.66, -0.55);
  spire.rotation.y = Math.PI / 4;
  group.add(spire);
  for (const [x, z] of [[0.85, -0.14], [1.26, -0.55]]) {
    const w = mesh(new THREE.BoxGeometry(x === 0.85 ? 0.2 : 0.02, 0.34, x === 0.85 ? 0.02 : 0.2), glow, x, 1.6, z, false);
    group.add(w);
  }
  // Orb of knowledge above the spire: recall beams start here.
  const orb = mesh(new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshLambertMaterial({ color: "#3a78c0", emissive: "#1a59cc" }), 0.85, 3.4, -0.55, false);
  orb.name = "libraryOrb";
  orb.userData.keep = true;
  group.add(orb);
  const light = new THREE.PointLight("#5aa9ff", 3, 4, 1.5);
  light.position.set(0.85, 3.2, -0.55);
  group.add(light);
  // Book lecterns in the yard
  for (const [x, z] of [[-1.05, -0.8], [-0.45, -0.95]]) {
    group.add(mesh(new THREE.BoxGeometry(0.08, 0.35, 0.08), wood, x, 0.27, z));
    group.add(mesh(new THREE.BoxGeometry(0.28, 0.05, 0.2), mat("#8a2f2f"), x, 0.47, z));
  }
  title(group, "Library", "GBrain", 2.05, -0.55, 0.9); // over the hall, keeps the spire clear for beams

  let pulseT = 0;
  const orbMat = orb.material as THREE.MeshLambertMaterial;
  return {
    anchor: orb,
    top: new THREE.Vector3(0.85, 3.4, -0.55),
    tick(t: number, dt: number) {
      orb.position.y = 3.4 + Math.sin(t * 1.6) * 0.06;
      orb.rotation.y += dt * 0.8;
      pulseT = Math.max(0, pulseT - dt);
      const p = pulseT > 0 ? Math.sin((pulseT / 0.9) * Math.PI) : 0;
      orb.scale.setScalar(1 + p * 0.8);
      orbMat.emissive.setRGB(0.1 + p * 0.7, 0.35 + p * 0.5, 0.8 + p * 0.2);
      light.intensity = 3 + Math.sin(t * 2) * 0.4 + p * 10;
    },
    pulse() { pulseT = 0.9; },
  };
}

function barracks(group: THREE.Group) {
  const timber = mat("#a8743f"), beam = mat("#4d3118"), roofM = mat("#9a3b2c"), stone = mat("#8c8478");
  group.add(mesh(new THREE.BoxGeometry(2.3, 0.25, 1.6), stone, 0, 0.22, 0.1));
  group.add(mesh(new THREE.BoxGeometry(2.2, 0.75, 1.5), timber, 0, 0.72, 0.1));
  for (const x of [-1.1, -0.37, 0.37, 1.1]) {
    group.add(mesh(new THREE.BoxGeometry(0.08, 0.78, 0.08), beam, x, 0.72, 0.86));
    group.add(mesh(new THREE.BoxGeometry(0.08, 0.78, 0.08), beam, x, 0.72, -0.66));
  }
  group.add(mesh(new THREE.BoxGeometry(2.24, 0.07, 0.06), beam, 0, 0.72, 0.87));
  const roof = mesh(gableRoof(1.85, 2.5, 0.75), roofM, 0, 1.08, 0.1);
  roof.rotation.y = Math.PI / 2;
  group.add(roof);
  group.add(mesh(new THREE.BoxGeometry(0.42, 0.55, 0.04), beam, 0.1, 0.62, 0.87));
  // Flag
  group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5), beam, -1.25, 0.9, 1.0));
  const flag = mesh(new THREE.BoxGeometry(0.5, 0.32, 0.02), mat("#c23b30"), -1.0, 1.52, 1.0);
  flag.userData.keep = true;
  group.add(flag);
  // Weapon rack and training dummy
  for (let i = 0; i < 4; i++) {
    const s = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 4), mat("#6d5a44"), 1.25, 0.45, -0.3 + i * 0.16);
    s.rotation.x = 0.15;
    group.add(s);
  }
  group.add(mesh(new THREE.BoxGeometry(0.06, 0.06, 0.7), beam, 1.25, 0.6, -0.06));
  group.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 5), beam, 0.95, 0.4, 1.25));
  group.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 4).rotateZ(Math.PI / 2), beam, 0.95, 0.55, 1.25));
  group.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), mat("#c9ab6e"), 0.95, 0.82, 1.25));
  title(group, "Barracks", "spawn agents", 2.1);

  let pulseT = 0;
  return {
    anchor: group,
    top: new THREE.Vector3(-1.0, 1.6, 1.0),
    tick(t: number, dt: number) {
      flag.rotation.y = Math.sin(t * 2.3) * 0.25;
      pulseT = Math.max(0, pulseT - dt);
      group.scale.y = 1 + Math.sin((pulseT / 0.5) * Math.PI) * 0.05;
    },
    pulse() { pulseT = 0.5; },
  };
}

function forge(group: THREE.Group) {
  const stone = mat("#7a7268"), stoneDark = mat("#554f49"), roofM = mat("#5b3b24"), wood = mat("#6b4a2b");
  group.add(mesh(new THREE.BoxGeometry(2.0, 0.85, 1.5), stone, -0.2, 0.52, -0.1));
  const roof = mesh(gableRoof(1.8, 2.3, 0.65), roofM, -0.2, 0.95, -0.1);
  roof.rotation.y = Math.PI / 2;
  group.add(roof);
  // Open shed in front with posts and a lean-to roof
  for (const x of [-1.1, 0.7]) group.add(mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), wood, x, 0.45, 1.0));
  const lean = mesh(new THREE.BoxGeometry(2.0, 0.06, 0.75), roofM, -0.2, 0.88, 0.95);
  lean.rotation.x = 0.25;
  group.add(lean);
  // Chimney
  group.add(mesh(new THREE.BoxGeometry(0.46, 2.1, 0.46), stoneDark, 0.8, 1.1, -0.6));
  const top = mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), new THREE.MeshLambertMaterial({ color: "#ff9a3c", emissive: "#d24a00" }), 0.8, 2.17, -0.6, false);
  group.add(top);
  // Furnace mouth glowing orange
  const fireMat = new THREE.MeshLambertMaterial({ color: "#ffb35c", emissive: "#ff5a00" });
  group.add(mesh(new THREE.BoxGeometry(0.5, 0.4, 0.04), fireMat, 0.2, 0.35, 0.66, false));
  const fire = new THREE.PointLight("#ff7a1a", 6, 4.5, 1.4);
  fire.position.set(0.2, 0.6, 1.0);
  group.add(fire);
  // Anvil
  group.add(mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), mat("#3a3a3e"), -0.5, 0.21, 1.15));
  group.add(mesh(new THREE.BoxGeometry(0.36, 0.1, 0.16), mat("#4a4a50"), -0.5, 0.37, 1.15));
  // River water trough (the River in River)
  group.add(mesh(new THREE.BoxGeometry(0.6, 0.18, 0.3), wood, -1.25, 0.19, -0.2));
  group.add(mesh(new THREE.BoxGeometry(0.54, 0.02, 0.24), new THREE.MeshLambertMaterial({ color: "#4aa3d8", emissive: "#0d3a5c" }), -1.25, 0.28, -0.2, false));
  title(group, "Forge", "River", 2.55);

  // Smoke puffs from the chimney
  const puffs: THREE.Mesh[] = [];
  const puffGeo = new THREE.IcosahedronGeometry(0.14, 0);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshLambertMaterial({ color: "#9a9590", transparent: true, opacity: 0.6, depthWrite: false }));
    m.userData.phase = i / 6;
    puffs.push(m);
    group.add(m);
  }
  const banner = workBanner(group, 3.05);
  let working = false;

  let pulseT = 0;
  return {
    anchor: fire,
    top: new THREE.Vector3(0.8, 2.25, -0.6),
    setWork(progress: number | null, label = "") {
      working = progress != null;
      banner.set(progress, label);
    },
    tick(t: number, dt: number) {
      pulseT = Math.max(0, pulseT - dt);
      const p = pulseT > 0 ? Math.sin((pulseT / 1.2) * Math.PI) : 0;
      const w = working ? 1 : 0;
      fire.intensity = 5 + w * 5 + Math.sin(t * (13 + w * 10)) * (0.8 + w) + Math.sin(t * 7.3) * 0.7 + p * 12;
      fireMat.emissive.setRGB(1, 0.35 + Math.sin(t * 11) * 0.05 + p * 0.3, p * 0.3);
      for (const m of puffs) {
        const ph = (t * 0.35 + m.userData.phase) % 1;
        m.position.set(0.8 + Math.sin(ph * 5 + m.userData.phase * 9) * 0.12 + ph * 0.3, 2.25 + ph * 1.4, -0.6 - ph * 0.2);
        m.scale.setScalar(0.6 + ph * 1.6);
        (m.material as THREE.MeshLambertMaterial).opacity = (working ? 0.75 : 0.55) * (1 - ph);
      }
      if (working) banner.sprite.position.y = 3.05 + Math.sin(t * 2) * 0.04;
    },
    pulse() { pulseT = 1.2; },
  };
}

/** Parchment progress banner above the Forge while a type is being forged. */
function workBanner(group: THREE.Group, y: number) {
  const bannerCanvas = document.createElement("canvas");
  bannerCanvas.width = 320; bannerCanvas.height = 72;
  const bannerTex = new THREE.CanvasTexture(bannerCanvas);
  bannerTex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Sprite(new THREE.SpriteMaterial({ map: bannerTex, depthTest: false, transparent: true }));
  banner.scale.set(2.6, 2.6 * 72 / 320, 1);
  banner.center.set(0.5, 0);
  banner.position.set(0, y, 0);
  banner.renderOrder = 10;
  banner.visible = false;
  group.add(banner);
  let bannerKey = "";
  return {
    sprite: banner,
    set(progress: number | null, label = "") {
      banner.visible = progress != null;
      if (progress == null) return;
      const key = `${Math.round(progress * 50)}|${label}`;
      if (key === bannerKey) return;
      bannerKey = key;
      const ctx = bannerCanvas.getContext("2d")!;
      ctx.clearRect(0, 0, 320, 72);
      ctx.fillStyle = "#f1e3bf"; ctx.strokeStyle = "#6b4e2a"; ctx.lineWidth = 3;
      ctx.fillRect(2, 2, 316, 68); ctx.strokeRect(2, 2, 316, 68);
      ctx.fillStyle = "#3a2a18"; ctx.fillRect(14, 44, 292, 16);
      const grad = ctx.createLinearGradient(14, 0, 306, 0);
      grad.addColorStop(0, "#ff8a1a"); grad.addColorStop(1, "#ffd05a");
      ctx.fillStyle = grad; ctx.fillRect(14, 44, 292 * Math.max(0, Math.min(1, progress)), 16);
      ctx.fillStyle = "#2b1d0e"; ctx.font = `600 22px "Iowan Old Style", Palatino, Georgia, serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(label.length > 30 ? label.slice(0, 29) + "\u2026" : label, 14, 24);
      bannerTex.needsUpdate = true;
    },
  };
}
