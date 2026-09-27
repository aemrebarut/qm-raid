// Monsters and camps: bugs are slimes, goblin camps and an ogre warcamp; features are crystal outcrops and ruins.
// Bigger and meaner with severity (1..4). Pure three.js, no game logic. Built around the origin, resting on y = 0,
// facing +z, inside a radius of about 0.35 + 0.1 * severity.
import * as THREE from "three";
import type { TargetArt, TargetOpts, TargetState } from "./types";

// ---------- shared resources ----------

const matCache = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: THREE.ColorRepresentation) {
  const key = new THREE.Color(color).getHexString();
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = new THREE.MeshLambertMaterial({ color, flatShading: true })));
  return m;
}
function geo<T extends THREE.BufferGeometry>(g: T) {
  g.userData.shared = true;
  return g;
}

const G = {
  blob: geo(new THREE.IcosahedronGeometry(0.2, 1)),
  eye: geo(new THREE.SphereGeometry(0.035, 6, 4)),
  pupil: geo(new THREE.SphereGeometry(0.018, 5, 3)),
  // goblin
  gLeg: geo(new THREE.BoxGeometry(0.05, 0.1, 0.05).translate(0, -0.05, 0)),
  gBody: geo(new THREE.CylinderGeometry(0.07, 0.09, 0.14, 6).translate(0, 0.07, 0)),
  gLoin: geo(new THREE.CylinderGeometry(0.095, 0.105, 0.06, 6)),
  gHead: geo(new THREE.IcosahedronGeometry(0.075, 0)),
  gEar: geo(new THREE.ConeGeometry(0.03, 0.13, 4).rotateZ(Math.PI / 2).translate(0.065, 0, 0)),
  gNose: geo(new THREE.ConeGeometry(0.02, 0.06, 4).rotateX(Math.PI / 2)),
  gArm: geo(new THREE.BoxGeometry(0.04, 0.12, 0.04).translate(0, -0.06, 0)),
  gEye: geo(new THREE.BoxGeometry(0.022, 0.012, 0.01)),
  spear: geo(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 4)),
  spearTip: geo(new THREE.ConeGeometry(0.02, 0.07, 4)),
  club: geo(new THREE.CylinderGeometry(0.035, 0.014, 0.22, 5).translate(0, 0.11, 0)),
  helmHorn: geo(new THREE.ConeGeometry(0.018, 0.08, 4)),
  // ogre
  oBelly: geo(new THREE.IcosahedronGeometry(0.2, 1)),
  oChest: geo(new THREE.CylinderGeometry(0.2, 0.17, 0.22, 7)),
  oHead: geo(new THREE.IcosahedronGeometry(0.09, 0)),
  oArm: geo(new THREE.CylinderGeometry(0.06, 0.05, 0.26, 6).translate(0, -0.13, 0)),
  oFist: geo(new THREE.IcosahedronGeometry(0.06, 0)),
  oLeg: geo(new THREE.CylinderGeometry(0.07, 0.06, 0.2, 6).translate(0, -0.1, 0)),
  tusk: geo(new THREE.ConeGeometry(0.014, 0.05, 4)),
  bigClub: geo(new THREE.CylinderGeometry(0.07, 0.025, 0.46, 6).translate(0, 0.23, 0)),
  spike: geo(new THREE.ConeGeometry(0.015, 0.05, 4)),
  fur: geo(new THREE.IcosahedronGeometry(0.08, 0)),
  // camp
  tent: geo(new THREE.ConeGeometry(0.2, 0.3, 5, 1, true).translate(0, 0.15, 0)),
  tentPole: geo(new THREE.CylinderGeometry(0.008, 0.008, 0.38, 4).translate(0, 0.19, 0)),
  stone: geo(new THREE.DodecahedronGeometry(0.03, 0)),
  log: geo(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 5).rotateZ(Math.PI / 2)),
  flame: geo(new THREE.ConeGeometry(0.045, 0.14, 5).translate(0, 0.07, 0)),
  stake: geo(new THREE.CylinderGeometry(0.018, 0.022, 0.26, 5).translate(0, 0.13, 0)),
  stakeTip: geo(new THREE.ConeGeometry(0.022, 0.06, 5).translate(0, 0.29, 0)),
  totem: geo(new THREE.CylinderGeometry(0.035, 0.04, 0.5, 6).translate(0, 0.25, 0)),
  mask: geo(new THREE.BoxGeometry(0.1, 0.1, 0.04)),
  bannerPole: geo(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4).translate(0, 0.3, 0)),
  bannerCloth: geo(new THREE.PlaneGeometry(0.16, 0.2, 2, 1).translate(0.08, -0.1, 0)),
  // crystal and ruin
  crystal: geo(new THREE.OctahedronGeometry(0.1, 0).scale(1, 2.4, 1).translate(0, 0.22, 0)),
  rock: geo(new THREE.DodecahedronGeometry(0.12, 0)),
  column: geo(new THREE.CylinderGeometry(0.055, 0.06, 1, 7).translate(0, 0.5, 0)),
  capital: geo(new THREE.BoxGeometry(0.15, 0.04, 0.15)),
  slab: geo(new THREE.BoxGeometry(0.2, 0.05, 0.2)),
  lintel: geo(new THREE.BoxGeometry(0.46, 0.07, 0.12)),
  shard: geo(new THREE.OctahedronGeometry(0.035, 0)),
  step: geo(new THREE.CylinderGeometry(1, 1, 0.06, 8)),
  camp: geo(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2)),
};

const BUG_SKIN: Record<number, string> = { 1: "#7fc241", 2: "#6f9c34", 3: "#5f8a2c", 4: "#b0553a" };
const BUG_WAR: Record<number, string> = { 1: "#7fc241", 2: "#e0892e", 3: "#c0392b", 4: "#8e1c1c" };
const CRYSTAL: Record<number, [string, string]> = {
  1: ["#8fe3ee", "#1c8a9a"], 2: ["#a590f0", "#4a34b0"], 3: ["#f08fe0", "#9a1c8a"], 4: ["#ffd76a", "#b07a10"],
};
const GREY = new THREE.Color("#8c8a85");
const WHITE = new THREE.Color("#ffffff");

function part(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const p = new THREE.Mesh(g, m);
  p.position.set(x, y, z);
  p.castShadow = shadow;
  p.receiveShadow = true;
  return p;
}

function mulberry(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- actors (things that animate) ----------

/** Anything in a camp that reacts: idles, gets agitated when engaged, flinches on hit, collapses on defeat. */
interface Actor {
  obj: THREE.Object3D;
  base: THREE.Vector3;
  kind: "slime" | "goblin" | "ogre" | "crystal" | "fire" | "banner" | "tent" | "prop";
  phase: number;
  /** Optional rig bits. */
  arm?: THREE.Object3D;
  head?: THREE.Object3D;
  legs?: THREE.Object3D[];
  flames?: THREE.Mesh[];
  /** Direction the actor falls on defeat (radians around y). */
  fall: number;
}

interface Build {
  root: THREE.Group;
  actors: Actor[];
  /** Materials that flash white on hit and turn grey on defeat. */
  skins: THREE.MeshLambertMaterial[];
  /** Materials that glow (crystals, eyes, fire); dim on defeat. */
  glows: THREE.MeshLambertMaterial[];
  radius: number;
  height: number;
  owned: THREE.Material[];
}

function newBuild(): Build {
  return { root: new THREE.Group(), actors: [], skins: [], glows: [], radius: 0.4, height: 0.5, owned: [] };
}

function ownedMat(b: Build, color: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation, list?: THREE.MeshLambertMaterial[]) {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
  if (emissive !== undefined) m.emissive = new THREE.Color(emissive);
  m.userData.color = m.color.clone();
  m.userData.emissive = m.emissive.clone();
  b.owned.push(m);
  list?.push(m);
  return m;
}

function slime(b: Build, size: number, x: number, z: number, color: string, phase: number) {
  const skin = ownedMat(b, color, new THREE.Color(color).multiplyScalar(0.25), b.skins);
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const body = part(G.blob, skin, 0, 0.16, 0);
  body.scale.set(1, 0.8, 1);
  const white = mat("#ffffff"), black = mat("#161616");
  g.add(body);
  for (const s of [-1, 1]) {
    const eye = part(G.eye, white, s * 0.07, 0.22, 0.15, false);
    eye.scale.set(1, 1.25, 1);
    g.add(eye, part(G.pupil, black, s * 0.07, 0.225, 0.18, false));
  }
  // a drip on top
  const drip = part(G.blob, skin, 0.05, 0.3, -0.02);
  drip.scale.setScalar(0.28);
  g.add(drip);
  g.scale.setScalar(size);
  b.root.add(g);
  b.actors.push({ obj: g, base: g.position.clone(), kind: "slime", phase, fall: phase * 6, head: body });
  return g;
}

function goblin(b: Build, x: number, z: number, rot: number, skinColor: string, opts: { chief?: boolean; weapon: "spear" | "club"; war: string; phase: number; size?: number }) {
  const skin = ownedMat(b, skinColor, undefined, b.skins);
  const leather = mat("#5a3a22"), wood = mat("#6b4a2b"), bone = mat("#e8dcc0"), metal = mat("#8d949c");
  const eyeM = ownedMat(b, "#ffe14a", "#ffb000", b.glows);
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  const hips = new THREE.Group();
  hips.position.y = 0.1;
  g.add(hips);
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group();
    l.position.x = s * 0.035;
    l.add(part(G.gLeg, skin));
    hips.add(l);
    legs.push(l);
  }
  hips.add(part(G.gBody, leather, 0, 0, 0), part(G.gLoin, mat(opts.war), 0, 0.01, 0));
  const head = new THREE.Group();
  head.position.y = 0.2;
  hips.add(head);
  const h = part(G.gHead, skin);
  h.scale.set(1.1, 0.95, 1);
  head.add(h, part(G.gNose, skin, 0, -0.01, 0.075, false));
  for (const s of [-1, 1]) {
    const ear = part(G.gEar, skin, s * 0.03, 0.01, 0, false);
    ear.scale.x = s;
    ear.rotation.z = s * 0.25;
    head.add(ear, part(G.gEye, eyeM, s * 0.028, 0.015, 0.066, false));
  }
  if (opts.chief) {
    head.add(part(new THREE.CylinderGeometry(0.075, 0.08, 0.05, 7), metal, 0, 0.05, 0));
    for (const s of [-1, 1]) {
      const horn = part(G.helmHorn, bone, s * 0.07, 0.09, 0, false);
      horn.rotation.z = -s * 0.6;
      head.add(horn);
    }
  }
  // Left arm hangs, right arm holds the weapon and does the attack.
  const armL = part(G.gArm, skin, -0.085, 0.12, 0);
  armL.rotation.z = -0.25;
  hips.add(armL);
  const arm = new THREE.Group();
  arm.position.set(0.085, 0.12, 0);
  arm.add(part(G.gArm, skin));
  const hand = new THREE.Group();
  hand.position.y = -0.11;
  arm.add(hand);
  if (opts.weapon === "spear") {
    const sp = part(G.spear, wood, 0, 0.08, 0.02);
    hand.add(sp, part(G.spearTip, metal, 0, 0.32, 0.02, false));
  } else {
    const c = part(G.club, wood, 0, -0.02, 0);
    c.rotation.x = 0.5;
    hand.add(c);
  }
  hips.add(arm);
  g.scale.setScalar(opts.size ?? (opts.chief ? 1.35 : 1));
  b.root.add(g);
  b.actors.push({ obj: g, base: g.position.clone(), kind: "goblin", phase: opts.phase, arm, head, legs, fall: rot + Math.PI });
  return g;
}

function ogre(b: Build, x: number, z: number, rot: number, war: string) {
  const skin = ownedMat(b, "#a8563a", undefined, b.skins);
  const leather = mat("#4a2e1a"), wood = mat("#5e4027"), bone = mat("#efe4c8");
  const eyeM = ownedMat(b, "#ff5a2a", "#ff2a00", b.glows);
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  const hips = new THREE.Group();
  hips.position.y = 0.2;
  g.add(hips);
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group();
    l.position.x = s * 0.09;
    l.add(part(G.oLeg, skin));
    hips.add(l);
    legs.push(l);
  }
  const belly = part(G.oBelly, skin, 0, 0.12, 0.02);
  belly.scale.set(1, 0.9, 0.95);
  hips.add(belly, part(G.oChest, skin, 0, 0.28, -0.01));
  const loin = part(G.gLoin, mat(war), 0, 0.02, 0);
  loin.scale.set(2, 1.4, 2);
  hips.add(loin);
  for (const s of [-1, 1]) hips.add(part(G.fur, mat("#6a5540"), s * 0.19, 0.4, -0.01));
  const head = new THREE.Group();
  head.position.set(0, 0.46, 0.05);
  hips.add(head);
  const hd = part(G.oHead, skin);
  hd.scale.set(1.15, 1, 1.05);
  head.add(hd);
  for (const s of [-1, 1]) {
    head.add(part(G.gEye, eyeM, s * 0.035, 0.02, 0.085, false));
    const t = part(G.tusk, bone, s * 0.04, -0.045, 0.075, false);
    t.rotation.set(-0.3, 0, -s * 0.3);
    head.add(t);
  }
  const armL = part(G.oArm, skin, -0.25, 0.38, 0);
  armL.rotation.z = -0.3;
  hips.add(armL);
  armL.add(part(G.oFist, skin, 0, -0.28, 0));
  const arm = new THREE.Group();
  arm.position.set(0.25, 0.38, 0);
  arm.add(part(G.oArm, skin));
  arm.add(part(G.oFist, skin, 0, -0.28, 0));
  const club = new THREE.Group();
  club.position.y = -0.28;
  club.rotation.x = 0.6;
  club.add(part(G.bigClub, wood));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const sp = part(G.spike, bone, Math.cos(a) * 0.06, 0.38, Math.sin(a) * 0.06, false);
    sp.rotation.set(Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3);
    club.add(sp);
  }
  arm.add(club);
  hips.add(arm);
  b.root.add(g);
  b.actors.push({ obj: g, base: g.position.clone(), kind: "ogre", phase: 0.3, arm, head, legs, fall: rot + Math.PI });
  return g;
}

function tent(b: Build, x: number, z: number, rot: number, hide: string, size = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  const cloth = ownedMat(b, hide);
  cloth.side = THREE.DoubleSide;
  g.add(part(G.tent, cloth), part(G.tentPole, mat("#5a3d22"), 0, 0, 0, false));
  for (let i = 0; i < 3; i++) {
    const p = part(G.tentPole, mat("#5a3d22"), 0, 0.27, 0, false);
    p.scale.y = 0.35;
    p.rotation.set(0.5 * Math.cos(i * 2.1), 0, 0.5 * Math.sin(i * 2.1));
    g.add(p);
  }
  g.scale.setScalar(size);
  b.root.add(g);
  b.actors.push({ obj: g, base: g.position.clone(), kind: "tent", phase: 0, fall: rot });
}

function fire(b: Build, x: number, z: number, size = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const stone = mat("#7d7a74");
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const s = part(G.stone, stone, Math.cos(a) * 0.08, 0.015, Math.sin(a) * 0.08);
    s.rotation.set(a, a * 2, 0);
    g.add(s);
  }
  for (let i = 0; i < 3; i++) {
    const l = part(G.log, mat("#4a3020"), 0, 0.03, 0);
    l.rotation.y = (i / 3) * Math.PI;
    g.add(l);
  }
  const outer = ownedMat(b, "#ff8a1e", "#ff5a00", b.glows);
  const inner = ownedMat(b, "#ffe27a", "#ffc02a", b.glows);
  const f1 = part(G.flame, outer, 0, 0.03, 0, false);
  const f2 = part(G.flame, inner, 0.01, 0.03, 0.01, false);
  f2.scale.setScalar(0.6);
  const f3 = part(G.flame, outer, -0.03, 0.03, 0.02, false);
  f3.scale.setScalar(0.55);
  g.add(f1, f2, f3);
  g.scale.setScalar(size);
  b.root.add(g);
  b.actors.push({ obj: g, base: g.position.clone(), kind: "fire", phase: x * 3 + z, flames: [f1, f2, f3], fall: 0 });
}

function stakes(b: Build, r: number, count: number, from: number, to: number) {
  const wood = mat("#6e4c2c"), tip = mat("#d8c9a4");
  for (let i = 0; i < count; i++) {
    const a = from + ((to - from) * i) / Math.max(1, count - 1);
    const s = new THREE.Group();
    s.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    s.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    s.scale.y = 0.8 + ((i * 37) % 10) / 25;
    s.add(part(G.stake, wood), part(G.stakeTip, tip, 0, 0, 0, false));
    b.root.add(s);
  }
}

function banner(b: Build, x: number, z: number, color: string, h = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.add(part(G.bannerPole, mat("#4a3020")));
  const clothM = ownedMat(b, color);
  clothM.side = THREE.DoubleSide;
  const cloth = part(G.bannerCloth, clothM, 0, 0.58, 0);
  g.add(cloth);
  // a skull-ish mark (two eye holes) on the banner, stylised and bloodless
  const dark = mat("#1a1210");
  for (const s of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.025, 0.025, 0.012), dark, 0.08 + s * 0.03, 0.5, 0.004, false));
  g.scale.setScalar(h);
  b.root.add(g);
  b.actors.push({ obj: g, base: g.position.clone(), kind: "banner", phase: x, head: cloth, fall: 0.3 });
}

function totem(b: Build, x: number, z: number, war: string) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.add(part(G.totem, mat("#5e4027")));
  const face = part(G.mask, mat(war), 0, 0.42, 0.03);
  const face2 = part(G.mask, mat("#e8dcc0"), 0, 0.28, 0.03);
  face2.scale.set(0.8, 0.8, 1);
  const eyeM = ownedMat(b, "#ffcf4a", "#ff9a00", b.glows);
  g.add(face, face2);
  for (const s of [-1, 1]) g.add(part(G.gEye, eyeM, s * 0.025, 0.44, 0.052, false));
  for (const s of [-1, 1]) {
    const horn = part(G.helmHorn, mat("#e8dcc0"), s * 0.06, 0.5, 0.02, false);
    horn.rotation.z = -s * 0.7;
    horn.scale.setScalar(1.5);
    g.add(horn);
  }
  b.root.add(g);
  b.actors.push({ obj: g, base: g.position.clone(), kind: "prop", phase: 0, fall: 0.6 });
}

function campGround(b: Build, r: number, color: string) {
  const m = part(G.camp, mat(color), 0, 0.004, 0, false);
  m.scale.setScalar(r);
  b.root.add(m);
}

// ---------- bug camps ----------

function buildBug(b: Build, sev: number, rnd: () => number) {
  const war = BUG_WAR[sev];
  if (sev <= 1) {
    b.radius = 0.45;
    b.height = 0.45;
    campGround(b, 0.42, "#4f6a2a");
    slime(b, 1.25, 0, 0.02, BUG_SKIN[1], 0);
    slime(b, 0.5, -0.24, 0.14, "#9ad45a", 1.7);
    slime(b, 0.42, 0.22, -0.16, "#9ad45a", 3.1);
    return;
  }
  if (sev === 2) {
    b.radius = 0.55;
    b.height = 0.5;
    campGround(b, 0.52, "#6a5236");
    tent(b, -0.18, -0.22, 0.4, "#8a6a44");
    fire(b, 0.14, -0.02, 0.9);
    goblin(b, -0.12, 0.2, 0.3, BUG_SKIN[2], { weapon: "spear", war, phase: 0 });
    goblin(b, 0.3, 0.2, -0.4, BUG_SKIN[2], { weapon: "club", war, phase: 1.3 });
    banner(b, 0.34, -0.3, war, 0.8);
    return;
  }
  if (sev === 3) {
    b.radius = 0.65;
    b.height = 0.7;
    campGround(b, 0.62, "#5e4630");
    stakes(b, 0.6, 7, Math.PI * 0.95, Math.PI * 2.05);
    tent(b, -0.28, -0.2, 0.5, "#7a5a3a", 1.1);
    tent(b, 0.26, -0.3, -0.3, "#6e4e30", 0.9);
    fire(b, 0.02, 0.02, 1.05);
    totem(b, -0.05, -0.42, war);
    goblin(b, 0.0, 0.3, 0, BUG_SKIN[3], { chief: true, weapon: "club", war, phase: 0.4 });
    goblin(b, -0.34, 0.18, 0.6, BUG_SKIN[3], { weapon: "spear", war, phase: 2.2 });
    goblin(b, 0.36, 0.14, -0.6, BUG_SKIN[3], { weapon: "spear", war, phase: 3.5 });
    banner(b, 0.5, -0.1, war, 1);
    return;
  }
  // 4: ogre warcamp
  b.radius = 0.75;
  b.height = 1.0;
  campGround(b, 0.72, "#4e3a2a");
  stakes(b, 0.7, 9, Math.PI * 0.9, Math.PI * 2.1);
  tent(b, -0.34, -0.3, 0.5, "#5a3e28", 1.25);
  fire(b, 0.3, -0.15, 1.3);
  totem(b, 0.05, -0.5, war);
  banner(b, -0.55, 0.05, war, 1.2);
  banner(b, 0.58, -0.35, war, 1.2);
  ogre(b, -0.02, 0.12, 0, war);
  goblin(b, -0.38, 0.3, 0.5, BUG_SKIN[3], { weapon: "spear", war, phase: 1.1 });
  goblin(b, 0.4, 0.28, -0.5, BUG_SKIN[3], { weapon: "club", war, phase: 2.6 });
  void rnd;
}

// ---------- feature sites ----------

function crystalCluster(b: Build, x: number, z: number, size: number, sev: number, rnd: () => number, count = 4) {
  const [c, e] = CRYSTAL[sev] ?? CRYSTAL[1];
  const m = ownedMat(b, c, e, b.glows);
  b.skins.push(m);
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const rock = part(G.rock, mat("#77746e"), 0, 0.03, 0);
  rock.scale.set(1.2, 0.5, 1.1);
  g.add(rock);
  const parts: [number, number, number, number, number][] = [[0, 0, 1, 0, 0], [0.08, 0.04, 0.65, 0.35, 0.3], [-0.07, 0.05, 0.6, -0.4, -0.2], [0.02, -0.08, 0.5, 0.2, -0.5], [-0.04, -0.05, 0.45, -0.3, 0.6]];
  for (let i = 0; i < Math.min(count, parts.length); i++) {
    const [px, pz, s, tz, tx] = parts[i];
    const cr = part(G.crystal, m, px, 0, pz);
    cr.scale.setScalar(s * (0.9 + rnd() * 0.2));
    cr.rotation.set(tx * 0.8, rnd() * 3, tz);
    g.add(cr);
  }
  g.scale.setScalar(size);
  b.root.add(g);
  b.actors.push({ obj: g, base: g.position.clone(), kind: "crystal", phase: x * 5 + z * 3, fall: 0 });
  return g;
}

function column(b: Build, x: number, z: number, h: number, broken: boolean) {
  const stone = mat("#b9b2a2"), moss = mat("#6b7d45");
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const c = part(G.column, stone);
  c.scale.y = h;
  g.add(c, part(G.capital, stone, 0, 0.02, 0));
  if (!broken) g.add(part(G.capital, stone, 0, h, 0));
  else {
    const top = part(G.capital, moss, 0, h, 0);
    top.scale.set(0.7, 0.8, 0.7);
    top.rotation.set(0.3, 0.5, 0.2);
    g.add(top);
  }
  b.root.add(g);
  b.actors.push({ obj: g, base: g.position.clone(), kind: "prop", phase: 0, fall: x + z });
  return g;
}

function floating(b: Build, y: number, size: number, sev: number) {
  const [c, e] = CRYSTAL[sev] ?? CRYSTAL[1];
  const m = ownedMat(b, c, e, b.glows);
  b.skins.push(m);
  const g = new THREE.Group();
  g.position.set(0, y, 0);
  const big = part(G.crystal, m, 0, -0.22, 0);
  big.scale.setScalar(size);
  g.add(big);
  const ring = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ring.add(part(G.shard, m, Math.cos(a) * 0.2 * size, 0.05, Math.sin(a) * 0.2 * size, false));
  }
  g.add(ring);
  b.root.add(g);
  b.actors.push({ obj: g, base: g.position.clone(), kind: "crystal", phase: 0.5, head: ring, fall: 0 });
}

function buildFeature(b: Build, sev: number, rnd: () => number) {
  const stone = mat("#a39c8c");
  if (sev <= 1) {
    b.radius = 0.4;
    b.height = 0.55;
    crystalCluster(b, 0, 0, 1.15, 1, rnd, 4);
    crystalCluster(b, 0.22, 0.14, 0.45, 1, rnd, 2);
    return;
  }
  if (sev === 2) {
    b.radius = 0.55;
    b.height = 0.6;
    campGround(b, 0.5, "#7b766a");
    crystalCluster(b, 0.02, 0.04, 1.2, 2, rnd, 5);
    column(b, -0.32, -0.18, 0.35, true);
    column(b, 0.3, -0.28, 0.22, true);
    const rubble = part(G.slab, stone, 0.26, 0.02, 0.26);
    rubble.rotation.set(0.2, 0.7, 0.1);
    b.root.add(rubble);
    crystalCluster(b, -0.26, 0.24, 0.5, 2, rnd, 3);
    return;
  }
  if (sev === 3) {
    b.radius = 0.65;
    b.height = 0.9;
    const plat = part(G.step, stone, 0, 0.03, 0);
    plat.scale.set(0.55, 1, 0.55);
    b.root.add(plat);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      column(b, Math.cos(a) * 0.46, Math.sin(a) * 0.46, i % 2 ? 0.62 : 0.3 + rnd() * 0.15, i % 2 === 0);
    }
    floating(b, 0.62, 1.25, 3);
    crystalCluster(b, 0.18, 0.1, 0.45, 3, rnd, 3);
    crystalCluster(b, -0.2, 0.05, 0.4, 3, rnd, 2);
    return;
  }
  // 4: ancient shrine, stepped platform, arch, golden crystal with orbiting shards
  b.radius = 0.75;
  b.height = 1.2;
  const s1 = part(G.step, stone, 0, 0.03, 0);
  s1.scale.set(0.72, 1, 0.72);
  const s2 = part(G.step, mat("#b7b09f"), 0, 0.09, 0);
  s2.scale.set(0.5, 1, 0.5);
  b.root.add(s1, s2);
  column(b, -0.36, -0.3, 0.8, false);
  column(b, 0.36, -0.3, 0.8, false);
  const lintel = part(G.lintel, mat("#b9b2a2"), 0, 0.84, -0.3);
  lintel.scale.x = 1.7;
  b.root.add(lintel);
  column(b, -0.55, 0.22, 0.4, true);
  column(b, 0.55, 0.25, 0.3, true);
  floating(b, 0.78, 1.55, 4);
  crystalCluster(b, 0.3, 0.3, 0.5, 4, rnd, 3);
  crystalCluster(b, -0.3, 0.32, 0.45, 4, rnd, 3);
}

// ---------- factory and animation ----------

export function makeTarget(opts: TargetOpts): TargetArt & { readonly radius: number; readonly height: number; readonly state: TargetState } {
  const sev = Math.max(1, Math.min(4, Math.round(opts.severity || 1)));
  const rnd = mulberry(opts.seed ?? sev * 101 + (opts.kind === "bug" ? 0 : 7));
  const b = newBuild();
  if (opts.kind === "feature") buildFeature(b, sev, rnd);
  else buildBug(b, sev, rnd);
  const object3d = new THREE.Group();
  object3d.name = `art-target:${opts.kind}:${sev}`;
  object3d.add(b.root);

  let state: TargetState = "open";
  let flash = 0;        // hit flash, seconds left
  let recoil = 0;       // hit shake
  let defeatT = -1;     // seconds since defeat began, -1 = not defeated
  const DEFEAT_LEN = 1.2;
  const bugs = opts.kind === "bug";
  let lastT = 0;

  function applyResolvedMaterials(k: number) {
    for (const m of b.skins) {
      m.color.copy(m.userData.color).lerp(GREY, k);
      m.emissive.copy(m.userData.emissive).multiplyScalar(1 - k * 0.9);
    }
    for (const m of b.glows) if (!b.skins.includes(m)) m.emissive.copy(m.userData.emissive).multiplyScalar(1 - k);
  }

  function tick(t: number, dt: number) {
    lastT = t;
    const engaged = state === "engaged";
    const dead = state === "resolved";
    if (defeatT >= 0) defeatT += dt;
    const dk = dead ? (defeatT >= 0 ? Math.min(1, defeatT / DEFEAT_LEN) : 1) : 0;
    flash = Math.max(0, flash - dt);
    recoil = Math.max(0, recoil - dt * 4);
    const shake = recoil > 0 ? Math.sin(t * 90) * 0.03 * recoil : 0;
    b.root.position.x = shake;

    for (const a of b.actors) {
      const o = a.obj;
      const ph = a.phase;
      switch (a.kind) {
        case "slime": {
          const k = engaged ? 8 : 2.6;
          const s = Math.sin(t * k + ph);
          const base = o.userData.s ?? (o.userData.s = o.scale.x);
          if (dead) {
            o.scale.set(base * (1 + dk * 0.45), base * (1 - dk * 0.7), base * (1 + dk * 0.45));
            o.position.y = 0;
          } else {
            const hop = engaged ? Math.max(0, Math.sin(t * k * 0.5 + ph)) * 0.08 : 0;
            o.scale.set(base * (1 + s * 0.06), base * (1 - s * 0.08 - recoil * 0.2), base * (1 + s * 0.06));
            o.position.y = hop;
            o.rotation.y = engaged ? Math.sin(t * 13 + ph) * 0.2 : Math.sin(t * 0.6 + ph) * 0.3;
          }
          break;
        }
        case "goblin":
        case "ogre": {
          const big = a.kind === "ogre";
          if (dead) {
            // topple backwards
            const f = Math.min(1, dk * 1.4);
            o.rotation.x = -f * (Math.PI / 2 - 0.15) * (big ? 0.95 : 1);
            o.position.y = f * (big ? 0.12 : 0.05);
            if (a.arm) a.arm.rotation.x = -f * 1.2;
            break;
          }
          o.rotation.x = -recoil * 0.25;
          o.position.y = 0;
          const atk = engaged ? (t * (big ? 1.4 : 2.2) + ph) % 1 : 0;
          if (a.arm) {
            if (engaged) {
              // wind up, swing down
              const sw = atk < 0.6 ? -2.4 * (atk / 0.6) : -2.4 + 3.2 * Math.min(1, (atk - 0.6) / 0.12);
              a.arm.rotation.x = sw;
            } else a.arm.rotation.x = -0.3 + Math.sin(t * 1.5 + ph) * 0.12;
          }
          if (a.head) a.head.rotation.y = engaged ? Math.sin(t * 6 + ph) * 0.2 : Math.sin(t * 0.5 + ph) * 0.6;
          if (a.legs) {
            const j = engaged ? Math.sin(t * 10 + ph) * 0.35 : 0;
            a.legs[0].rotation.x = j;
            a.legs[1].rotation.x = -j;
          }
          o.position.y = engaged ? Math.abs(Math.sin(t * 10 + ph)) * (big ? 0.015 : 0.025) : 0;
          break;
        }
        case "crystal": {
          if (dead) {
            o.position.y = a.base.y * (1 - dk) ;
            o.rotation.z = dk * 0.3;
            if (a.head) a.head.scale.setScalar(Math.max(0.001, 1 - dk));
            break;
          }
          const spin = engaged ? 1.6 : 0.35;
          if (a.base.y > 0) {
            o.position.y = a.base.y + Math.sin(t * 1.5 + ph) * 0.04;
            o.rotation.y += dt * spin;
            if (a.head) a.head.rotation.y += dt * spin * 2;
          } else {
            o.rotation.y = Math.sin(t * 0.3 + ph) * 0.05 + (engaged ? Math.sin(t * 25 + ph) * 0.03 : 0);
          }
          break;
        }
        case "fire": {
          const on = 1 - dk;
          a.flames?.forEach((f, i) => {
            const flick = 0.85 + 0.25 * Math.sin(t * (13 + i * 5) + ph + i) * Math.sin(t * 7.3 + i);
            f.scale.set(on * (1 - i * 0.2), Math.max(0.001, on * flick * (engaged ? 1.35 : 1) * (1 - i * 0.2)), on * (1 - i * 0.2));
            f.rotation.y = t * (1 + i);
          });
          break;
        }
        case "banner": {
          if (a.head) a.head.rotation.y = Math.sin(t * (engaged ? 6 : 2.2) + ph) * 0.35;
          o.rotation.z = dead ? dk * 0.9 : 0;
          break;
        }
        case "tent": {
          const s = 1 - dk * 0.65;
          o.scale.y = (o.userData.sy ?? (o.userData.sy = o.scale.y)) * s;
          o.rotation.z = dk * 0.2;
          break;
        }
        case "prop": {
          o.rotation.z = dead ? dk * (bugs ? 0.8 : 0.15) * Math.sign(Math.sin(a.fall) || 1) : 0;
          break;
        }
      }
    }

    // Materials: hit flash to white, resolved fades to grey
    if (dead) applyResolvedMaterials(dk);
    else if (flash > 0 || b.skins.some((m) => m.userData.flashed)) {
      const f = flash > 0 ? Math.min(1, flash / 0.12) : 0;
      for (const m of b.skins) {
        m.emissive.copy(m.userData.emissive).lerp(WHITE, f * 0.85);
        m.userData.flashed = f > 0;
      }
    }
    // Crystal and eye glow pulse
    if (!dead) {
      const pulse = engaged ? 0.75 + 0.5 * (0.5 + 0.5 * Math.sin(t * 9)) : 0.85 + 0.15 * Math.sin(t * 2);
      for (const m of b.glows) if (flash <= 0) m.emissive.copy(m.userData.emissive).multiplyScalar(pulse);
    }
  }

  const handle = {
    object3d,
    get radius() { return b.radius; },
    get height() { return b.height; },
    get state() { return state; },
    tick,
    setState(s: TargetState) {
      if (s === state) return;
      if (s === "resolved") {
        if (defeatT < 0) defeatT = 999; // straight to the resolved look (no collapse replay on load)
      } else {
        defeatT = -1;
        applyResolvedMaterials(0);
        resetPose();
      }
      state = s;
    },
    hit() {
      if (state === "resolved") return;
      flash = 0.14;
      recoil = 1;
    },
    defeat() {
      if (state === "resolved" && defeatT >= 0 && defeatT < DEFEAT_LEN) return;
      state = "resolved";
      defeatT = 0;
    },
    dispose() {
      for (const m of b.owned) m.dispose();
      object3d.traverse((o) => {
        const g = (o as THREE.Mesh).geometry;
        if (g && !g.userData.shared) g.dispose();
      });
    },
  };

  function resetPose() {
    for (const a of b.actors) {
      a.obj.rotation.x = 0;
      a.obj.rotation.z = 0;
      a.obj.position.copy(a.base);
      if (a.head && a.kind === "crystal") a.head.scale.setScalar(1);
      if (a.kind === "tent" && a.obj.userData.sy) a.obj.scale.y = a.obj.userData.sy;
    }
    tick(lastT, 0);
  }

  tick(0, 0);
  return handle;
}
