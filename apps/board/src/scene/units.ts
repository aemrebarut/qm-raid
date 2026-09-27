// Units: little medieval characters carrying staffs, tinted by team, animated by status, smoothly walking between tiles.
import * as THREE from "three";
import type { Unit } from "../core";
import { hash, makeBubble, makeLabel, mat, mesh, tileToWorld } from "./util";
import type { Router } from "./terrain";

let router: Router | null = null;
/** Set by the scene when the layout changes: units then walk through zone gates. */
export function setRouter(r: Router | null) { router = r; }

const NEUTRAL = "#8d8f96";
const UNIT_SCALE = 1.5; // readable at whole-map zoom
const SKIN = "#e6c09a";
const STAFF_GEM_IDLE = new THREE.Color("#2f86d6");

// Shared geometries (never disposed).
const G = {
  leg: new THREE.BoxGeometry(0.07, 0.18, 0.08),
  body: new THREE.CylinderGeometry(0.11, 0.16, 0.3, 8),
  belt: new THREE.CylinderGeometry(0.135, 0.135, 0.04, 8),
  head: new THREE.SphereGeometry(0.095, 10, 8),
  helmet: new THREE.CylinderGeometry(0.1, 0.105, 0.09, 8),
  plume: new THREE.ConeGeometry(0.03, 0.12, 5),
  shield: new THREE.CylinderGeometry(0.11, 0.11, 0.03, 10),
  hood: new THREE.ConeGeometry(0.12, 0.2, 8),
  cloak: new THREE.ConeGeometry(0.17, 0.4, 8, 1, true),
  cap: new THREE.SphereGeometry(0.1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
  feather: new THREE.ConeGeometry(0.018, 0.16, 4),
  robe: new THREE.ConeGeometry(0.19, 0.5, 8),
  hat: new THREE.ConeGeometry(0.1, 0.24, 8),
  staff: new THREE.CylinderGeometry(0.016, 0.02, 0.78, 5),
  gem: new THREE.OctahedronGeometry(0.045, 0),
  ring: new THREE.RingGeometry(0.26, 0.32, 28),
  hit: new THREE.CylinderGeometry(0.42, 0.42, 1.1, 8), // generous pick volume, units are small
};
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

const STATUS_TEXT: Record<string, string> = {
  idle: "idle", moving: "walking", recalling: "recalling", working: "working",
  remembering: "remembering", waiting_approval: "awaiting approval", error: "error",
};

const BUBBLES: Record<string, [string, string, string] | undefined> = {
  working: ["⚒", "#2b1d0e", "#f1e3bf"],
  recalling: ["✦", "#ffffff", "#3b82d6"],
  remembering: ["✦", "#2b1d0e", "#f0c24a"],
  waiting_approval: ["?", "#2b1d0e", "#f0d34a"],
  error: ["!", "#ffffff", "#c0392b"],
};

export class UnitView {
  readonly group = new THREE.Group();
  readonly id: string;
  unit: Unit;
  private readonly root = new THREE.Group();   // bobs and turns
  private readonly staffPivot = new THREE.Group();
  private readonly legs: THREE.Mesh[] = [];
  private readonly tinted: THREE.Mesh[] = [];
  private readonly gemMat = new THREE.MeshLambertMaterial({ color: "#9fd6ff", emissive: STAFF_GEM_IDLE.clone() });
  private readonly selRing: THREE.Mesh;
  private bubble: THREE.Sprite | null = null;
  private bubbleKey = "";
  private nameTag: THREE.Sprite | null = null;
  private nameTagText = "";
  private readonly jitter: THREE.Vector3;
  readonly dest = new THREE.Vector3();
  /** Gate waypoints before dest (visual routing only; the engine position is dest). */
  private waypoints: THREE.Vector3[] = [];
  private facing = 0;
  private walkPhase = 0;
  private moving = false;
  private selected = false;
  private hovered = false;
  /** World point the unit faces while working (its target), or null. */
  faceTo: THREE.Vector3 | null = null;
  /** Staff raised (recall / remember), 0..1, eased. */
  private raise = 0;
  /** Seconds left of a raise forced by a memory event, and which kind. */
  private raiseHold = 0;
  private raiseKind: "recall" | "remember" = "recall";
  private lastChop = 0;
  private teamMat: THREE.MeshLambertMaterial | null = null;
  /** Called at the peak of each working strike with the impact point (sparks). */
  onStrike: ((p: THREE.Vector3) => void) | null = null;

  constructor(unit: Unit, teamColor: string | null, spawnFrom?: THREE.Vector3) {
    this.id = unit.id;
    this.unit = unit;
    const h = hash(unit.id);
    this.jitter = new THREE.Vector3(((h & 0xff) / 255 - 0.5) * 0.36, 0, (((h >> 8) & 0xff) / 255 - 0.5) * 0.36);
    this.group.userData = { kind: "unit", id: unit.id };
    this.group.name = `unit:${unit.id}`;
    this.group.scale.setScalar(UNIT_SCALE);
    this.group.add(this.root);

    this.selRing = new THREE.Mesh(G.ring, new THREE.MeshBasicMaterial({ color: "#7dff6a", transparent: true, depthWrite: false }));
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.position.y = 0.025;
    this.selRing.visible = false;
    this.group.add(this.selRing);
    // Pick volume: invisible (no draw call) but still raycast, three's Raycaster ignores visibility.
    const hit = mesh(G.hit, hitMat, 0, 0.55, 0, false);
    hit.visible = false;
    this.group.add(hit);

    this.build(unit.class, teamColor);
    this.dest.copy(this.worldOf(unit));
    this.group.position.copy(spawnFrom ?? this.dest); // spawned units walk out of their building
    this.facing = Math.PI / 4;
    this.update(unit, teamColor);
  }

  private worldOf(u: Unit) {
    return tileToWorld(u.pos.x, u.pos.y).add(this.jitter);
  }

  private build(cls: string, teamColor: string | null) {
    const team = new THREE.MeshLambertMaterial({ color: teamColor ?? NEUTRAL, flatShading: true });
    this.teamMat = team;
    const dark = mat("#3b2f25"), skin = mat(SKIN), leather = mat("#6b4a2b"), metal = mat("#b3b8bf");
    const scale = cls === "scout" ? 0.88 : cls === "knight" ? 1.06 : 1;
    this.root.scale.setScalar(scale);

    for (const x of [-0.055, 0.055]) {
      const l = mesh(G.leg, dark, x, 0.09, 0);
      this.legs.push(l);
      this.root.add(l);
    }
    const body = mesh(G.body, team, 0, 0.33, 0);
    this.tinted.push(body);
    this.root.add(body, mesh(G.belt, leather, 0, 0.28, 0), mesh(G.head, skin, 0, 0.57, 0));

    if (cls === "knight") {
      this.root.add(mesh(G.helmet, metal, 0, 0.63, 0));
      const plume = mesh(G.plume, team, 0, 0.72, -0.02);
      this.tinted.push(plume);
      const shield = mesh(G.shield, team, -0.16, 0.34, 0.03);
      shield.rotation.z = Math.PI / 2;
      this.tinted.push(shield);
      this.root.add(plume, shield, mesh(new THREE.TorusGeometry(0.11, 0.012, 4, 12), metal, -0.178, 0.34, 0.03).rotateY(Math.PI / 2));
    } else if (cls === "ranger") {
      const green = mat("#3f6b35");
      this.root.add(mesh(G.hood, green, 0, 0.66, -0.01));
      const cloak = mesh(G.cloak, green, 0, 0.32, -0.03);
      this.root.add(cloak);
      const quiver = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 5), leather, 0.07, 0.42, -0.13);
      quiver.rotation.z = 0.4;
      this.root.add(quiver);
    } else if (cls === "scout") {
      this.root.add(mesh(G.cap, mat("#8a5a2b"), 0, 0.6, 0));
      const f = mesh(G.feather, team, 0.06, 0.7, -0.03);
      f.rotation.z = -0.5;
      this.tinted.push(f);
      this.root.add(f);
    } else {
      // oracle or a forged type: robe and pointed hat, tinted per type
      const tint = new THREE.Color().setHSL((hash(cls) % 360) / 360, 0.45, 0.45);
      const robeMat = new THREE.MeshLambertMaterial({ color: cls === "oracle" ? "#6a4bb0" : tint, flatShading: true });
      this.root.add(mesh(G.robe, robeMat, 0, 0.25, 0), mesh(G.hat, robeMat, 0, 0.72, 0));
      const sash = mesh(G.belt, team, 0, 0.36, 0);
      this.tinted.push(sash);
      this.root.add(sash);
    }

    // Staff in the right hand, pivoting at the hand so it can be raised or swung.
    this.staffPivot.position.set(0.17, 0.32, 0.04);
    this.staffPivot.add(mesh(G.staff, leather, 0, 0.18, 0));
    const gem = mesh(G.gem, this.gemMat, 0, 0.6, 0, false);
    gem.name = "gem";
    this.staffPivot.add(gem);
    this.root.add(this.staffPivot);
  }

  /** World position of the staff tip (for beams and orbs). */
  staffTip(out = new THREE.Vector3()) {
    const gem = this.staffPivot.getObjectByName("gem")!;
    return gem.getWorldPosition(out);
  }

  update(unit: Unit, teamColor: string | null) {
    const clsChanged = unit.class !== this.unit.class;
    this.unit = unit;
    if (clsChanged) {
      this.root.clear();
      this.legs.length = 0;
      this.tinted.length = 0;
      this.staffPivot.clear();
      this.build(unit.class, teamColor);
    }
    for (const m of this.tinted) (m.material as THREE.MeshLambertMaterial).color.set(teamColor ?? NEUTRAL);
    const d = this.worldOf(unit);
    if (d.distanceToSquared(this.dest) > 1e-6) {
      this.dest.copy(d);
      this.waypoints = router ? router(this.group.position, this.dest) : [];
    }
    this.setBubble(unit.status);
    this.syncDecor();
  }

  private setBubble(status: string) {
    const spec = BUBBLES[status];
    const key = spec ? status : "";
    if (key === this.bubbleKey) return;
    this.bubbleKey = key;
    if (this.bubble) {
      this.group.remove(this.bubble);
      this.bubble.material.map?.dispose();
      this.bubble.material.dispose();
      this.bubble = null;
    }
    if (spec) {
      this.bubble = makeBubble(spec[0], spec[1], spec[2], 0.34);
      this.bubble.position.y = 0.95;
      this.group.add(this.bubble);
    }
  }

  /** Raise the staff for a memory event even if the engine status lags behind. */
  flashRaise(kind: "recall" | "remember", secs = 2.2) {
    this.raiseKind = kind;
    this.raiseHold = secs;
  }

  setSelected(on: boolean) { this.selected = on; this.syncDecor(); }
  setHovered(on: boolean) { this.hovered = on; this.syncDecor(); }

  private syncDecor() {
    this.selRing.visible = this.selected || this.hovered;
    const m = this.selRing.material as THREE.MeshBasicMaterial;
    m.color.set(this.selected ? "#7dff6a" : "#ffffff");
    m.opacity = this.selected ? 0.95 : 0.45;
    const showName = this.selected || this.hovered;
    const text = `${this.unit.name} \u00b7 ${STATUS_TEXT[this.unit.status] ?? this.unit.status}`;
    if (this.nameTag && (!showName || text !== this.nameTagText)) {
      this.group.remove(this.nameTag);
      this.nameTag.material.map?.dispose();
      this.nameTag.material.dispose();
      this.nameTag = null;
    }
    if (showName && !this.nameTag) {
      const color = this.unit.status === "error" ? "#ffb0a8" : this.unit.status === "waiting_approval" ? "#ffe98a" : "#ffffff";
      this.nameTag = makeLabel(text, { height: 0.19, bg: null, color, font: 40 });
      this.nameTagText = text;
      this.group.add(this.nameTag);
    }
    if (this.nameTag) this.nameTag.position.y = this.bubble ? 1.3 : 0.95;
  }

  tick(t: number, dt: number) {
    const pos = this.group.position;
    while (this.waypoints.length && this.waypoints[0].distanceTo(pos) < 0.08) this.waypoints.shift();
    const next = this.waypoints[0] ?? this.dest;
    const to = next.clone().sub(pos);
    to.y = 0;
    const dist = to.length();
    // Remaining path length drives the catch-up speed.
    let remaining = dist;
    for (let i = 0; i < this.waypoints.length; i++) remaining += (this.waypoints[i + 1] ?? this.dest).distanceTo(this.waypoints[i]);
    // Teleport only on a large direct jump (reset, respawn); a routed detour through gates can be long
    // while the engine moved the unit a single tile.
    if (Math.hypot(this.dest.x - pos.x, this.dest.z - pos.z) > 14) {
      pos.copy(this.dest);
      this.waypoints = [];
      this.moving = false;
    } else if (dist > 0.01) {
      const speed = THREE.MathUtils.clamp(remaining * 2.2, 3.0, 10); // engine steps 3 tiles/s (diagonals too); catch up without stutter or zipping
      const step = Math.min(dist, speed * dt);
      pos.addScaledVector(to.normalize(), step);
      this.facing = turn(this.facing, Math.atan2(to.x, to.z), dt * 10);
      this.moving = true;
    } else {
      this.moving = false;
    }

    const status = this.unit.status;
    const walking = this.moving || status === "moving";
    if (!this.moving && this.faceTo && (status === "working" || status === "recalling" || status === "remembering")) {
      const f = this.faceTo.clone().sub(pos);
      if (f.lengthSq() > 0.01) this.facing = turn(this.facing, Math.atan2(f.x, f.z), dt * 6);
    }
    this.root.rotation.y = this.facing;

    // Walk cycle
    if (walking) this.walkPhase += dt * 11;
    const swing = walking ? Math.sin(this.walkPhase) * 0.6 : 0;
    this.legs[0] && (this.legs[0].rotation.x = swing);
    this.legs[1] && (this.legs[1].rotation.x = -swing);
    this.root.position.y = walking ? Math.abs(Math.sin(this.walkPhase)) * 0.04 : 0;

    // Staff pose by status
    this.raiseHold = Math.max(0, this.raiseHold - dt);
    const raised = status === "recalling" || status === "remembering" || this.raiseHold > 0 ? 1 : 0;
    this.raise += (raised - this.raise) * Math.min(1, dt * 8);
    let staffX = -0.15 + (walking ? Math.sin(this.walkPhase) * 0.12 : 0);
    let staffZ = 0;
    if (status === "working" && !this.moving) {
      // Chop: quick strike, slow recovery
      const c = (t * 1.8 + (hash(this.id) % 100) / 100) % 1;
      const strike = c < 0.25 ? c / 0.25 : 1 - (c - 0.25) / 0.75;
      if (this.lastChop < 0.25 && c >= 0.25 && this.onStrike) {
        // Impact point: in front of the unit, toward its target
        const dir = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
        this.onStrike(pos.clone().addScaledVector(dir, 0.45 * UNIT_SCALE).setY(0.25));
      }
      this.lastChop = c;
      staffX = 0.3 + strike * 1.1;
      this.root.rotation.x = strike * 0.12;
    } else {
      this.root.rotation.x = 0;
    }
    if (this.raise > 0.01) {
      staffX = staffX * (1 - this.raise) - 0.1 * this.raise;
      staffZ = -0.35 * this.raise;
      this.staffPivot.position.y = 0.32 + 0.22 * this.raise;
    } else {
      this.staffPivot.position.y = 0.32;
    }
    this.staffPivot.rotation.set(staffX, 0, staffZ);

    // Gem colour: blue when recalling, gold when remembering, soft blue otherwise
    const e = this.gemMat.emissive;
    const kind = this.raiseHold > 0 ? this.raiseKind : status === "remembering" ? "remember" : status === "recalling" ? "recall" : null;
    if (kind === "remember") e.setRGB(0.9, 0.62, 0.1);
    else if (kind === "recall") e.setRGB(0.25 + 0.2 * Math.sin(t * 8), 0.6, 1);
    else if (status === "error") e.setRGB(0.8, 0.1, 0.1);
    else e.copy(STAFF_GEM_IDLE);

    // Idle breathing, error wobble
    if (!walking && status === "idle") this.root.scale.y = this.root.scale.x * (1 + Math.sin(t * 2 + this.jitter.x * 20) * 0.02);
    else this.root.scale.y = this.root.scale.x;
    this.root.rotation.z = status === "error" ? Math.sin(t * 6) * 0.08 : 0;
    // Error: the tunic flashes red
    if (this.teamMat) {
      if (status === "error") this.teamMat.emissive.setRGB(0.5 + 0.5 * Math.sin(t * 10), 0, 0);
      else if (this.teamMat.emissive.r !== 0) this.teamMat.emissive.setRGB(0, 0, 0);
    }

    if (this.bubble) this.bubble.position.y = 0.95 + Math.sin(t * 3) * 0.03;
  }

  dispose() {
    for (const s of [this.bubble, this.nameTag]) {
      s?.material.map?.dispose();
      s?.material.dispose();
    }
    this.gemMat.dispose();
    for (const m of this.tinted) (m.material as THREE.Material).dispose();
  }
}

function turn(from: number, to: number, k: number) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * Math.min(1, k);
}
