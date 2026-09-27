// Characters: villager-scale low-poly people with a readable silhouette per class, team-colour tabards and a staff.
// Pure three.js, no game logic. Model space: feet at y = 0, about 0.8 tall, facing +z. The caller moves and turns
// object3d; the unit animates itself in tick(t, dt) according to the animation set with play().
import * as THREE from "three";

import type { UnitAnim, UnitArt, UnitOpts } from "./types";
import { addOutline, bakeRigid, type Baked } from "./rigid";
import { contactShadow } from "./lighting";

export type BuiltinClass = "knight" | "ranger" | "scout" | "oracle";
export const UNIT_CLASSES: BuiltinClass[] = ["knight", "ranger", "scout", "oracle"];
export const UNIT_ANIMS: UnitAnim[] = ["idle", "walk", "work", "cast", "celebrate", "error"];

/** UnitArt plus a few extras the board may use. */
export interface UnitHandle extends UnitArt {
  object3d: THREE.Group;
  /** speed scales the cycle (walk: 1 = about 3 tiles per second). */
  play(anim: UnitAnim, opts?: { speed?: number }): void;
  readonly anim: UnitAnim;
  /** Gem colour: "recall" blue, "remember" gold, null back to the class colour. */
  setGlow(kind: "recall" | "remember" | null): void;
  /** Model height at scale 1 (bubbles and name tags). */
  readonly height: number;
}

// ---------- palette and shared resources ----------

const SKINS = ["#f0c8a0", "#e2b48a", "#c98f62", "#9c6644", "#f3d2b3"];
const HAIRS = ["#3b2a1d", "#6b4423", "#a8742f", "#2a2522", "#8a8a88", "#c9a066"];
const NEUTRAL = "#8d8f96";
const GEM_IDLE = "#58b4ff";
const RECALL = new THREE.Color("#5fc2ff");
const REMEMBER = new THREE.Color("#ffc53a");

/** Stable colour for a forged type id (hue from its hash). */
export function typeColor(cls: string) {
  const h = hashStr(cls);
  return new THREE.Color().setHSL((h % 360) / 360, 0.75, 0.55);
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const matCache = new Map<string, THREE.MeshLambertMaterial>();
const _hsl = { h: 0, s: 0, l: 0 };
/** Readability lift under ACES at board zoom: brighter and a little more saturated. */
function lift(color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  c.getHSL(_hsl);
  return c.setHSL(_hsl.h, Math.min(1, _hsl.s * 1.15), Math.min(0.9, _hsl.l * 1.22 + 0.04));
}
/** Shared flat material per colour (lifted); never mutate or dispose the result. */
function mat(color: THREE.ColorRepresentation) {
  const key = new THREE.Color(color).getHexString();
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = new THREE.MeshLambertMaterial({ color: lift(color), flatShading: true })));
  return m;
}

function geo<T extends THREE.BufferGeometry>(g: T) {
  g.userData.shared = true; // callers' dispose helpers skip shared geometry
  return g;
}

/** Staff pennant: a swallow-tail flag, hoist along the staff (+y), flying toward +x. */
function pennantGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0, 0.11);
  s.lineTo(0.17, 0.1);
  s.lineTo(0.11, 0.055);
  s.lineTo(0.17, 0.0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false });
  g.translate(0, 0, -0.004);
  return g;
}

/** Kite shield outline, flat side facing +z. */
function kiteShield() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.13);
  s.quadraticCurveTo(0.1, 0.12, 0.095, 0.03);
  s.quadraticCurveTo(0.08, -0.08, 0, -0.16);
  s.quadraticCurveTo(-0.08, -0.08, -0.095, 0.03);
  s.quadraticCurveTo(-0.1, 0.12, 0, 0.13);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -0.0125);
  return g;
}

const G = {
  leg: geo(new THREE.BoxGeometry(0.075, 0.17, 0.08).translate(0, -0.085, 0)),
  boot: geo(new THREE.BoxGeometry(0.085, 0.055, 0.12).translate(0, -0.17, 0.018)),
  robeLeg: geo(new THREE.BoxGeometry(0.075, 0.06, 0.1).translate(0, -0.17, 0.02)),
  torso: geo(new THREE.CylinderGeometry(0.115, 0.135, 0.25, 8).translate(0, 0.125, 0)),
  skirt: geo(new THREE.CylinderGeometry(0.135, 0.165, 0.11, 8).translate(0, -0.03, 0)),
  robe: geo(new THREE.CylinderGeometry(0.13, 0.2, 0.3, 8).translate(0, -0.08, 0)),
  belt: geo(new THREE.CylinderGeometry(0.14, 0.14, 0.035, 8)),
  buckle: geo(new THREE.BoxGeometry(0.04, 0.035, 0.02)),
  tabard: geo(new THREE.BoxGeometry(0.17, 0.31, 0.02).translate(0, -0.02, 0)),
  pennant: geo(pennantGeo()),
  tabardTrim: geo(new THREE.BoxGeometry(0.16, 0.025, 0.024)),
  upperArm: geo(new THREE.BoxGeometry(0.06, 0.13, 0.065).translate(0, -0.06, 0)),
  foreArm: geo(new THREE.BoxGeometry(0.055, 0.1, 0.06).translate(0, -0.05, 0)),
  hand: geo(new THREE.SphereGeometry(0.036, 6, 4)),
  pauldron: geo(new THREE.SphereGeometry(0.065, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2)),
  neck: geo(new THREE.CylinderGeometry(0.04, 0.045, 0.05, 6)),
  head: geo(new THREE.IcosahedronGeometry(0.1, 1)),
  nose: geo(new THREE.BoxGeometry(0.025, 0.035, 0.03)),
  eye: geo(new THREE.BoxGeometry(0.018, 0.022, 0.01)),
  hairCap: geo(new THREE.SphereGeometry(0.105, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55)),
  beard: geo(new THREE.BoxGeometry(0.1, 0.07, 0.05)),
  // knight
  helm: geo(new THREE.CylinderGeometry(0.108, 0.112, 0.15, 8)),
  helmTop: geo(new THREE.SphereGeometry(0.108, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)),
  visor: geo(new THREE.BoxGeometry(0.15, 0.018, 0.03)),
  crest: geo(new THREE.BoxGeometry(0.035, 0.1, 0.19)),
  shield: geo(kiteShield()),
  boss: geo(new THREE.SphereGeometry(0.03, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2)),
  // ranger
  hood: geo(new THREE.ConeGeometry(0.135, 0.26, 8, 1, true)),
  hoodBack: geo(new THREE.SphereGeometry(0.125, 8, 6, Math.PI * 0.1, Math.PI * 1.8)),
  cloak: geo(new THREE.CylinderGeometry(0.12, 0.2, 0.42, 8, 1, true, Math.PI * 0.62, Math.PI * 0.76)),
  quiver: geo(new THREE.CylinderGeometry(0.035, 0.03, 0.24, 6)),
  arrow: geo(new THREE.ConeGeometry(0.018, 0.06, 4)),
  bowLimb: geo(new THREE.TorusGeometry(0.2, 0.011, 4, 10, Math.PI * 0.62)),
  // scout
  cap: geo(new THREE.CylinderGeometry(0.1, 0.12, 0.07, 8)),
  capBrim: geo(new THREE.CylinderGeometry(0.16, 0.16, 0.015, 10)),
  feather: geo(new THREE.ConeGeometry(0.022, 0.2, 4).translate(0, 0.1, 0)),
  capelet: geo(new THREE.ConeGeometry(0.2, 0.16, 8, 1, true)),
  satchel: geo(new THREE.BoxGeometry(0.08, 0.08, 0.04)),
  // oracle and forged
  wizardHat: geo(new THREE.ConeGeometry(0.11, 0.23, 8)),
  hatBrim: geo(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 10)),
  rune: geo(new THREE.BoxGeometry(0.028, 0.06, 0.012)),
  runeBar: geo(new THREE.BoxGeometry(0.06, 0.014, 0.012)),
  halo: geo(new THREE.TorusGeometry(0.22, 0.008, 4, 28)),
  haloRune: geo(new THREE.OctahedronGeometry(0.028, 0)),
  // staff
  shaft: geo(new THREE.CylinderGeometry(0.014, 0.018, 0.84, 5).translate(0, 0.2, 0)),
  crook: geo(new THREE.TorusGeometry(0.045, 0.012, 4, 8, Math.PI * 1.4)),
  gemCage: geo(new THREE.TorusGeometry(0.04, 0.007, 3, 8)),
  gem: geo(new THREE.OctahedronGeometry(0.042, 0)),
  wrap: geo(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 5)),
};

// ---------- builder ----------

type Part = THREE.Mesh;
function part(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true): Part {
  const p = new THREE.Mesh(g, m);
  p.position.set(x, y, z);
  p.castShadow = shadow;
  p.receiveShadow = false;
  return p;
}

interface Rig {
  root: THREE.Object3D;  // bob, lean, jump
  hips: THREE.Object3D;  // at hip height
  torso: THREE.Object3D; // leans
  head: THREE.Object3D;
  legL: THREE.Object3D; legR: THREE.Object3D;
  armL: THREE.Object3D; armR: THREE.Object3D;
  elbowL: THREE.Object3D; elbowR: THREE.Object3D;
  wrist: THREE.Object3D; // staff grip in the right hand
  gem: THREE.Mesh;
  cape: THREE.Object3D | null;
  halo: THREE.Object3D | null;
}

const HIP_Y = 0.2;
const SHOULDER_Y = 0.22; // above the hips, in torso space

export function makeUnit(opts: UnitOpts & { outline?: boolean; shadow?: boolean }): UnitHandle {
  const cls = opts.cls;
  const builtin = (UNIT_CLASSES as string[]).includes(cls);
  const forged = opts.forged ?? !builtin;
  const robed = forged || cls === "oracle";
  const seed = opts.seed ?? hashStr(cls);
  const rnd = mulberry(seed);

  const teamMat = new THREE.MeshLambertMaterial({ color: lift(opts.teamColor ?? NEUTRAL), flatShading: true });
  const rc = forged ? new THREE.Color(opts.typeColor ?? typeColor(cls)) : cls === "oracle" ? new THREE.Color("#b58cff") : new THREE.Color(GEM_IDLE);
  const gemBase = rc.clone();
  const gemMat = new THREE.MeshLambertMaterial({ color: rc.clone().lerp(new THREE.Color("#ffffff"), 0.35), emissive: rc.clone(), emissiveIntensity: 0.9, flatShading: true });
  const runeMat = new THREE.MeshBasicMaterial({ color: rc.clone().lerp(new THREE.Color("#ffffff"), 0.2) });
  teamMat.userData.tag = "team";
  runeMat.userData.bake = "own";
  const owned: THREE.Material[] = [teamMat, gemMat, runeMat];

  const skin = mat(SKINS[Math.floor(rnd() * SKINS.length)]);
  const hair = mat(HAIRS[Math.floor(rnd() * HAIRS.length)]);
  const dark = mat("#2e2620");
  const leather = mat("#6e4a2a");
  const leatherDark = mat("#4a311d");
  const metal = mat("#b9c0c8");
  const metalDark = mat("#7c848e");
  const gold = mat("#d8a93a");
  const wood = mat("#7a5230");

  const cloth = cls === "knight" ? mat("#8c939c") // mail
    : cls === "ranger" ? mat("#4f6b3a")
    : cls === "scout" ? mat("#9b7a4f")
    : cls === "oracle" ? mat("#4b3a86")
    : mat(new THREE.Color("#2c2a38").lerp(rc, 0.18));
  const trouser = cls === "knight" ? metalDark : cls === "ranger" ? mat("#3a3226") : cls === "scout" ? mat("#5c4632") : dark;

  const root = new THREE.Bone();
  const hips = new THREE.Bone();
  hips.position.y = HIP_Y;
  root.add(hips);

  // Legs
  const mkLeg = (x: number) => {
    const g = new THREE.Bone();
    g.position.set(x, 0, 0);
    if (robed) g.add(part(G.robeLeg, dark));
    else g.add(part(G.leg, trouser), part(G.boot, cls === "knight" ? metalDark : leatherDark));
    hips.add(g);
    return g;
  };
  const legL = mkLeg(-0.055), legR = mkLeg(0.055);

  // Torso
  const torso = new THREE.Bone();
  hips.add(torso);
  torso.add(part(G.torso, cloth));
  if (robed) torso.add(part(G.robe, cloth));
  else torso.add(part(G.skirt, cls === "knight" ? cloth : cloth));
  const belt = part(G.belt, leather, 0, 0.005, 0);
  torso.add(belt, part(G.buckle, gold, 0, 0.005, 0.14, false));

  // Tabard front and back in team colour
  const tabF = part(G.tabard, teamMat, 0, 0.12, 0.128);
  tabF.rotation.x = -0.07;
  const tabB = part(G.tabard, teamMat, 0, 0.12, -0.128);
  tabB.rotation.x = 0.07;
  if (!robed) {
    torso.add(tabF, tabB, part(G.tabardTrim, gold, 0, -0.035, 0.136, false));
    if (cls === "knight") {
      // a simple cross device on the chest
      torso.add(part(new THREE.BoxGeometry(0.02, 0.11, 0.01), mat("#f1e6c8"), 0, 0.14, 0.141, false));
      torso.add(part(new THREE.BoxGeometry(0.08, 0.02, 0.01), mat("#f1e6c8"), 0, 0.16, 0.141, false));
    }
  } else {
    // robe: team sash across the chest, runes glowing down the front
    const sash = part(new THREE.BoxGeometry(0.05, 0.36, 0.3), teamMat, 0, 0.1, 0);
    sash.rotation.z = 0.55;
    sash.scale.set(1, 1, 0.94);
    torso.add(sash);
    const runeRows = forged ? 4 : 2;
    for (let i = 0; i < runeRows; i++) {
      const y = 0.02 - i * 0.07;
      const r = part(i % 2 ? G.runeBar : G.rune, runeMat, 0, y, 0.15 + i * 0.012, false);
      r.rotation.x = -0.25;
      torso.add(r);
      if (forged) {
        for (const s of [-1, 1]) {
          const side = part(G.rune, runeMat, s * 0.1, y - 0.01, 0.13 + i * 0.01, false);
          side.rotation.set(-0.25, s * 0.6, 0);
          torso.add(side);
        }
      }
    }
  }

  // Arms: shoulder -> elbow -> hand
  const mkArm = (side: -1 | 1) => {
    const arm = new THREE.Bone();
    arm.position.set(side * 0.155, SHOULDER_Y, 0);
    arm.add(part(G.upperArm, cloth));
    const elbow = new THREE.Bone();
    elbow.position.y = -0.12;
    elbow.add(part(G.foreArm, cls === "knight" ? metal : robed ? cloth : cloth), part(G.hand, skin, 0, -0.11, 0.005));
    arm.add(elbow);
    if (cls === "knight") arm.add(part(G.pauldron, metal, 0.005 * side, 0.005, 0));
    torso.add(arm);
    return { arm, elbow };
  };
  const { arm: armL, elbow: elbowL } = mkArm(-1);
  const { arm: armR, elbow: elbowR } = mkArm(1);

  // Head
  const head = new THREE.Bone();
  head.position.y = 0.36;
  head.scale.setScalar(1.22); // chibi: head about a third of the height
  torso.add(head);
  torso.add(part(G.neck, skin, 0, 0.27, 0, false));
  const face = part(G.head, skin, 0, 0, 0);
  head.add(face);
  const eyeM = mat("#1d1a18");
  if (cls !== "knight") {
    for (const s of [-1, 1]) head.add(part(G.eye, eyeM, s * 0.035, 0.01, 0.094, false));
    head.add(part(G.nose, skin, 0, -0.015, 0.1, false));
  }

  let cape: THREE.Object3D | null = null;
  let halo: THREE.Bone | null = null;
  /** Wrap a cape mesh in its own bone so it can swing. */
  const capeBone = (m: THREE.Mesh) => {
    const b = new THREE.Bone();
    b.position.copy(m.position).setY(m.position.y + 0.18);
    m.position.set(0, -0.18, 0);
    b.add(m);
    torso.add(b);
    return b;
  };

  if (cls === "knight") {
    head.add(part(G.helm, metal, 0, 0.01, 0), part(G.helmTop, metal, 0, 0.085, 0));
    head.add(part(G.visor, dark, 0, 0.02, 0.1, false));
    const vslit = part(new THREE.BoxGeometry(0.012, 0.06, 0.03), dark, 0, -0.02, 0.105, false);
    head.add(vslit);
    const crest = part(G.crest, teamMat, 0, 0.15, -0.01);
    head.add(crest);
    // Kite shield on the left forearm, facing outward
    const shield = new THREE.Group();
    shield.position.set(-0.045, -0.06, 0.02);
    shield.rotation.y = -Math.PI / 2 + 0.25;
    shield.add(part(G.shield, teamMat), part(G.boss, gold, 0, 0.02, 0.022, false).rotateX(Math.PI / 2));
    const stripe = part(new THREE.BoxGeometry(0.035, 0.24, 0.01), mat("#f1e6c8"), 0, -0.01, 0.026, false);
    shield.add(stripe);
    elbowL.add(shield);
    // short red-brown cape
    const c = part(G.cloak, teamMat, 0, 0.08, -0.02);
    c.scale.set(1.05, 0.85, 1.05);
    cape = capeBone(c);
  } else if (cls === "ranger") {
    const green = mat("#3d5a2c");
    head.add(part(G.hairCap, hair, 0, 0.01, -0.005));
    const hood = part(G.hood, green, 0, 0.1, -0.015);
    hood.rotation.x = -0.18;
    head.add(hood, part(G.hoodBack, green, 0, 0.0, -0.02));
    cape = capeBone(part(G.cloak, teamMat, 0, 0.06, -0.01)); // team cloak under the green hood
    const quiver = part(G.quiver, leather, 0.06, 0.16, -0.15);
    quiver.rotation.z = -0.45;
    torso.add(quiver);
    for (let i = 0; i < 3; i++) {
      const a = part(G.arrow, mat("#e8e0cc"), 0.1 + i * 0.018, 0.29 + i * 0.01, -0.15 + (i - 1) * 0.015, false);
      a.rotation.z = -0.45;
      torso.add(a);
    }
    head.add(part(G.beard, hair, 0, -0.075, 0.055, false).translateY(0.01));
  } else if (cls === "scout") {
    head.add(part(G.hairCap, hair, 0, 0.005, -0.01));
    head.add(part(G.cap, leather, 0, 0.085, 0), part(G.capBrim, leatherDark, 0, 0.06, 0));
    const feather = part(G.feather, teamMat, 0.08, 0.1, -0.03);
    feather.rotation.set(-0.5, 0, -0.7);
    head.add(feather);
    const c = part(G.capelet, teamMat, 0, 0.2, -0.005);
    torso.add(c); // shoulder capelet sits still
    const sat = part(G.satchel, leather, -0.15, -0.02, 0.02);
    sat.rotation.y = 0.3;
    torso.add(sat);
    const strap = part(new THREE.BoxGeometry(0.025, 0.36, 0.29), leatherDark, 0, 0.1, 0);
    strap.rotation.z = -0.6;
    strap.scale.set(1, 1, 0.97);
    torso.add(strap);
  } else {
    // oracle and forged: wide-brim pointed hat, beard for the oracle, rune halo for forged types
    const hatMat = cls === "oracle" ? mat("#3a2c6e") : mat(new THREE.Color("#23212c").lerp(rc, 0.3));
    head.add(part(G.hatBrim, hatMat, 0, 0.07, 0), part(G.wizardHat, hatMat, 0, 0.18, -0.01).rotateX(-0.12));
    const band = part(new THREE.CylinderGeometry(0.108, 0.11, 0.025, 8), forged ? runeMat : gold, 0, 0.095, 0, false);
    head.add(band);
    if (cls === "oracle") {
      const beard = part(G.beard, mat("#e8e4dc"), 0, -0.085, 0.06, false);
      beard.scale.set(1.1, 1.5, 1);
      head.add(beard, part(G.hairCap, mat("#e8e4dc"), 0, 0.0, -0.01));
    } else head.add(part(G.hairCap, hair, 0, 0.0, -0.01));
    if (forged) {
      halo = new THREE.Bone();
      halo.position.y = 0.12;
      const ring = part(G.halo, runeMat, 0, 0, 0, false);
      ring.rotation.x = Math.PI / 2;
      halo.add(ring);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        halo.add(part(G.haloRune, runeMat, Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22, false));
      }
      hips.add(halo);
    }
  }

  // Staff in the right hand. The wrist counter-rotates so the staff angle is set in body space.
  const wrist = new THREE.Bone();
  wrist.position.set(0, -0.11, 0.005);
  elbowR.add(wrist);
  const staff = new THREE.Group();
  staff.position.y = -0.02;
  wrist.add(staff);
  staff.add(part(G.shaft, wood), part(G.wrap, leatherDark, 0, 0.02, 0, false));
  const tipY = 0.62;
  let gem: THREE.Mesh;
  if (cls === "ranger") {
    // bow-staff: a recurve limb along the upper shaft, with a string
    const limb = part(G.bowLimb, wood, -0.06, 0.34, 0, true);
    limb.rotation.z = Math.PI * 0.19;
    staff.add(limb);
    const str = part(new THREE.CylinderGeometry(0.003, 0.003, 0.36, 3), mat("#efe6cf"), 0.0, 0.34, 0, false);
    staff.add(str);
    gem = part(G.gem, gemMat, 0, tipY, 0, false);
    staff.add(gem);
  } else if (cls === "knight") {
    const cross = part(new THREE.BoxGeometry(0.13, 0.022, 0.022), gold, 0, tipY - 0.07, 0, false);
    staff.add(cross);
    gem = part(G.gem, gemMat, 0, tipY, 0, false);
    staff.add(gem, part(G.gemCage, gold, 0, tipY, 0, false).rotateY(Math.PI / 2));
  } else if (robed) {
    const crook = part(G.crook, wood, 0.04, tipY - 0.03, 0, true);
    crook.rotation.z = Math.PI * 0.1;
    staff.add(crook);
    gem = part(G.gem, gemMat, 0.04, tipY - 0.03, 0, false);
    gem.scale.setScalar(1.25);
    staff.add(gem);
  } else {
    gem = part(G.gem, gemMat, 0, tipY - 0.04, 0, false);
    staff.add(gem, part(G.gemCage, metal, 0, tipY - 0.04, 0, false));
  }
  // Team pennant just under the head of the staff: reads red vs blue at whole-map zoom.
  const pen = part(G.pennant, teamMat, 0.012, tipY - 0.25, 0, false);
  if (cls !== "ranger") staff.add(pen); // the ranger's bow limb sits there; its cloak carries the colour
  staff.scale.setScalar(cls === "scout" ? 0.9 : 1);

  const scale = cls === "scout" ? 0.9 : cls === "knight" ? 1.07 : robed ? 1.02 : 1;
  root.scale.setScalar(scale);

  const object3d = new THREE.Group();
  object3d.name = `art-unit:${cls}`;
  object3d.add(root);
  gem.userData.keep = true; // stays a real mesh: its own glow material, and staffTip reads its world position
  const baked = bakeRigid(object3d);
  const outline = opts.outline === false ? null : addOutline(object3d, baked);
  // Soft contact blob at the feet (fake AO): a direct child of object3d so hops leave it on the ground. Shared geometry and material.
  if (opts.shadow !== false) object3d.add(contactShadow(0.22 * scale, 0.55));

  const rig: Rig = { root, hips, torso, head, legL, legR, armL, armR, elbowL, elbowR, wrist, gem, cape, halo };
  return animate(rig, {
    object3d, baked, outline, gemMat, gemBase, runeMat, owned, robed, forged, scale,
    phase: (seed % 1000) / 1000,
    height: 0.8 * scale,
    knight: cls === "knight",
  });
}

// ---------- animation ----------

interface Ctx {
  object3d: THREE.Group;
  baked: Baked;
  outline: THREE.SkinnedMesh | null;
  gemMat: THREE.MeshLambertMaterial;
  gemBase: THREE.Color;
  runeMat: THREE.MeshBasicMaterial;
  owned: THREE.Material[];
  robed: boolean;
  forged: boolean;
  scale: number;
  phase: number;
  height: number;
  knight: boolean;
}

/** One pose: every animated channel. Angles in radians. */
interface Pose {
  y: number; lean: number; twist: number; roll: number;
  legL: number; legR: number;
  armL: number; armLz: number; elbowL: number;
  armR: number; armRz: number; elbowR: number;
  staff: number;     // staff angle in body space (0 = upright, + tips forward)
  staffZ: number;
  head: number; headY: number;
  squash: number;
}

const ZERO: Pose = { y: 0, lean: 0, twist: 0, roll: 0, legL: 0, legR: 0, armL: 0.08, armLz: -0.12, elbowL: -0.25, armR: 0.1, armRz: 0.08, elbowR: -0.35, staff: 0.05, staffZ: 0, head: 0, headY: 0, squash: 1 };

const POSE_KEYS = Object.keys(ZERO) as (keyof Pose)[];
const ease = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function animate(rig: Rig, c: Ctx): UnitHandle {
  let anim: UnitAnim = "idle";
  let speed = 1;
  let glow: "recall" | "remember" | null = null;
  let walkPhase = 0;
  let workPhase = c.phase;
  let lastWork = workPhase;
  const cur: Pose = { ...ZERO };
  const tmp = new THREE.Vector3();
  const gemEm = new THREE.Color();
  const WHITE = new THREE.Color("#ffffff");

  const tg: Pose = { ...ZERO };
  const mainMat = c.baked.material();
  function target(t: number, dt: number): Pose {
    const p = Object.assign(tg, ZERO);
    const breathe = Math.sin(t * 2.1 + c.phase * 6.28);
    switch (anim) {
      case "idle": {
        p.y = breathe * 0.004;
        p.armL += breathe * 0.03;
        p.armR += breathe * 0.02;
        p.head = Math.sin(t * 0.7 + c.phase * 9) * 0.06;
        p.headY = Math.sin(t * 0.37 + c.phase * 4) * 0.35 * Math.max(0, Math.sin(t * 0.21 + c.phase * 3));
        p.squash = 1 + breathe * 0.012;
        break;
      }
      case "walk": {
        walkPhase += dt * 10.5 * speed;
        const s = Math.sin(walkPhase);
        const legAmp = c.robed ? 0.45 : 0.75;
        p.legL = s * legAmp;
        p.legR = -s * legAmp;
        p.y = Math.abs(Math.cos(walkPhase)) * 0.028;
        p.lean = 0.1;
        p.twist = s * 0.08;
        p.armL = -s * 0.55;
        p.elbowL = -0.35 - Math.max(0, -s) * 0.4;
        p.armR = s * 0.3 + 0.1;
        p.elbowR = -0.45;
        p.staff = 0.28 + s * 0.12;
        p.head = -0.05;
        break;
      }
      case "work": {
        // Two-handed staff strike: wind up over the head, snap down, slow recovery.
        workPhase += dt * 1.8 * speed;
        const k = workPhase % 1;
        let s: number; // 0 = wound up, 1 = struck
        if (k < 0.2) s = 1 - ease(k / 0.2) * 1.0;          // recover and lift
        else if (k < 0.62) s = 0;                           // hold high
        else if (k < 0.74) s = ease((k - 0.62) / 0.12);    // strike
        else s = 1;                                         // follow-through
        const wind = k >= 0.2 && k < 0.62 ? ease(Math.min(1, (k - 0.2) / 0.25)) : 0;
        const up = 1 - s;
        p.armR = lerp(-0.7, -2.7, up * (0.6 + 0.4 * wind));
        p.armRz = 0.02;
        p.elbowR = lerp(-0.2, -0.55, up);
        p.armL = lerp(-0.75, -2.5, up * (0.6 + 0.4 * wind));
        p.armLz = 0.42;
        p.elbowL = lerp(-0.3, -0.6, up);
        p.staff = lerp(1.95, -0.55, up * (0.6 + 0.4 * wind));
        p.lean = lerp(0.32, -0.12, up);
        p.head = lerp(0.18, -0.1, up);
        p.y = s > 0.95 ? -0.012 : 0;
        p.legL = -0.25;
        p.legR = 0.3;
        p.squash = s > 0.95 && k < 0.8 ? 0.95 : 1;
        break;
      }
      case "cast": {
        // Staff raised high (recall and remember), gentle float, off hand open.
        const w = Math.sin(t * 3.2 + c.phase * 5);
        p.armR = -2.85 + w * 0.04;
        p.armRz = -0.12;
        p.elbowR = -0.1;
        p.staff = 0.05 + w * 0.03;
        p.armL = -0.9 + w * 0.08;
        p.armLz = -0.55;
        p.elbowL = -0.5;
        p.lean = -0.12;
        p.head = -0.3;
        p.y = 0.01 + (w * 0.5 + 0.5) * 0.012;
        break;
      }
      case "celebrate": {
        const j = (t * 2.6 * speed + c.phase) % 1;
        const hop = Math.sin(j * Math.PI);
        p.y = hop * 0.12;
        p.squash = j < 0.08 || j > 0.92 ? 0.92 : 1 + hop * 0.03;
        p.armR = -2.9 + Math.sin(t * 9) * 0.2;
        p.armRz = -0.1;
        p.elbowR = -0.1;
        p.staff = Math.sin(t * 9) * 0.45;
        p.staffZ = Math.cos(t * 9) * 0.3;
        p.armL = -2.7 - Math.sin(t * 9) * 0.2;
        p.armLz = 0.3;
        p.elbowL = -0.2;
        p.head = -0.25;
        p.legL = -hop * 0.3;
        p.legR = hop * 0.3;
        break;
      }
      case "error": {
        const wob = Math.sin(t * 5.5);
        p.roll = wob * 0.1;
        p.lean = 0.28;
        p.head = 0.4;
        p.headY = Math.sin(t * 7) * 0.4;
        p.armL = 0.1;
        p.armR = 0.2;
        p.staff = 0.5 + wob * 0.1;
        p.squash = 0.96;
        break;
      }
    }
    return p;
  }

  function tick(t: number, dt: number) {
    target(t, dt);
    // Critically damped blend toward the target pose; fast channels for strikes.
    const k = Math.min(1, dt * (anim === "work" || anim === "walk" ? 22 : 9));
    for (const key of POSE_KEYS) cur[key] = lerp(cur[key], tg[key], k);

    const r = rig;
    r.root.position.y = cur.y;
    r.root.scale.set(c.scale * (2 - cur.squash) ** 0.5, c.scale * cur.squash, c.scale * (2 - cur.squash) ** 0.5);
    r.torso.rotation.set(cur.lean, cur.twist, cur.roll);
    r.legL.rotation.x = cur.legL;
    r.legR.rotation.x = cur.legR;
    r.armL.rotation.set(cur.armL, 0, cur.armLz);
    r.armR.rotation.set(cur.armR, 0, cur.armRz);
    r.elbowL.rotation.x = cur.elbowL;
    r.elbowR.rotation.x = cur.elbowR;
    // Staff angle in torso space = arm + elbow + wrist.
    r.wrist.rotation.set(cur.staff - cur.armR - cur.elbowR, 0, cur.staffZ - cur.armRz);
    r.head.rotation.set(cur.head, cur.headY, 0);
    if (r.cape) r.cape.rotation.x = -Math.max(0, cur.lean) * 0.5 - (anim === "walk" ? 0.18 + Math.sin(walkPhase * 2) * 0.05 : 0.02);
    if (r.halo) {
      r.halo.rotation.y = t * 1.3;
      r.halo.position.y = 0.12 + Math.sin(t * 2 + c.phase * 6) * 0.02;
    }

    // Strike event at the moment the staff lands.
    if (anim === "work") {
      const k0 = lastWork % 1, k1 = workPhase % 1;
      if ((k0 < 0.72 && k1 >= 0.72) || (k1 < k0 && k0 < 0.72)) {
        if (handle.onStrike) {
          r.gem.getWorldPosition(tmp);
          handle.onStrike(tmp.clone().setY(Math.max(0.02, tmp.y * 0.2)));
        }
      }
    }
    lastWork = workPhase;

    // Gem and rune glow
    const pulse = 0.5 + 0.5 * Math.sin(t * 7);
    if (glow === "recall") gemEm.copy(RECALL).multiplyScalar(0.8 + 0.6 * pulse);
    else if (glow === "remember") gemEm.copy(REMEMBER).multiplyScalar(0.8 + 0.6 * pulse);
    else if (anim === "cast") gemEm.copy(c.gemBase).multiplyScalar(1 + 0.6 * pulse);
    else if (anim === "error") gemEm.setRGB(0.9 * pulse, 0.05, 0.05);
    else gemEm.copy(c.gemBase).multiplyScalar(0.75 + 0.15 * Math.sin(t * 2 + c.phase * 6));
    c.gemMat.emissive.copy(gemEm);
    // Error: the whole unit pulses red (one material for the baked body)
    if (mainMat) {
      if (anim === "error") mainMat.emissive.setRGB(0.4 * pulse, 0, 0);
      else if (mainMat.emissive.r !== 0) mainMat.emissive.setRGB(0, 0, 0);
    }
    c.gemMat.color.copy(gemEm).lerp(WHITE, 0.4);
    if (c.forged) c.runeMat.color.copy(c.gemBase).multiplyScalar(0.75 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.4 + c.phase * 6))).lerp(WHITE, 0.15);
  }

  const handle: UnitHandle = {
    object3d: c.object3d,
    get anim() { return anim; },
    play(a, o) {
      if (a !== anim && a === "work") { workPhase = Math.floor(workPhase) + 0.25; lastWork = workPhase; }
      anim = a;
      speed = o?.speed ?? 1;
    },
    tick,
    setTeamColor(col) { c.baked.recolor("team", lift(col ?? NEUTRAL)); },
    setGlow(kind) { glow = kind; },
    staffTip(out = new THREE.Vector3()) { return rig.gem.getWorldPosition(out); },
    onStrike: null,
    height: c.height,
    dispose() {
      c.baked.dispose();
      c.outline?.geometry.dispose();
      for (const m of c.owned) m.dispose();
      // Non-shared geometries created per unit (tiny); shared ones are flagged userData.shared.
      c.object3d.traverse((o) => {
        const g = (o as THREE.Mesh).geometry;
        if (g && !g.userData.shared) g.dispose();
      });
    },
  };
  tick(0, 1);
  return handle;
}

function mulberry(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
