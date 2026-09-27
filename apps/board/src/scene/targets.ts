// Targets: bugs are monsters, features are crystal outcrops; both sized by severity, with a camp patch and an issue tag.
import * as THREE from "three";
import type { Target } from "../core";
import { hash, makeLabel, mat, mesh, tileToWorld } from "./util";

const BUG_COLORS: Record<number, string> = { 1: "#7fb341", 2: "#e0892e", 3: "#b8322a" };
const CRYSTAL_COLORS: Record<number, [string, string]> = { 1: ["#7ad7e0", "#1c7c8a"], 2: ["#8d7be6", "#3b2a9a"], 3: ["#e07ad0", "#8a1c7a"] };
const G = {
  body: new THREE.SphereGeometry(0.3, 12, 9),
  eye: new THREE.SphereGeometry(0.06, 8, 6),
  pupil: new THREE.SphereGeometry(0.032, 6, 5),
  horn: new THREE.ConeGeometry(0.05, 0.2, 5),
  tooth: new THREE.ConeGeometry(0.025, 0.07, 4),
  crystal: new THREE.OctahedronGeometry(0.2, 0),
  camp: new THREE.CircleGeometry(0.5, 14),
  ring: new THREE.RingGeometry(0.5, 0.58, 32),
  flagPole: new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4),
  flag: new THREE.BoxGeometry(0.3, 0.2, 0.02),
  hit: new THREE.CylinderGeometry(0.45, 0.45, 1, 8),
  puff: new THREE.IcosahedronGeometry(0.13, 0),
};
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
const GREY = "#8c8a85";

export class TargetView {
  readonly group = new THREE.Group();
  readonly id: string;
  target: Target;
  private readonly body = new THREE.Group();
  private readonly skin: THREE.MeshLambertMaterial;
  private readonly ring: THREE.Mesh;
  private readonly engagedRing: THREE.Mesh;
  private readonly flag: THREE.Group;
  private readonly tag: THREE.Sprite;
  private readonly size: number;
  private readonly phase: number;
  private selected = false;
  private hovered = false;
  private flash = 0;
  private readonly puffs: THREE.Mesh[] = [];

  constructor(t: Target) {
    this.id = t.id;
    this.target = t;
    this.phase = (hash(t.id) % 1000) / 160;
    this.size = 0.75 + 0.22 * (t.severity ?? 1);
    this.group.userData = { kind: "target", id: t.id };
    this.group.name = `target:${t.id}`;
    this.group.position.copy(tileToWorld(t.pos.x, t.pos.y));

    const camp = new THREE.Mesh(G.camp, mat("#5b4630"));
    camp.rotation.x = -Math.PI / 2;
    camp.position.y = 0.07;
    camp.scale.setScalar(this.size * 0.9);
    camp.receiveShadow = true;
    this.group.add(camp);

    this.ring = new THREE.Mesh(G.ring, new THREE.MeshBasicMaterial({ color: "#f2e27a", transparent: true, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.08;
    this.ring.scale.setScalar(this.size);
    this.ring.visible = false;
    this.engagedRing = new THREE.Mesh(G.ring, new THREE.MeshBasicMaterial({ color: "#ff4a3a", transparent: true, depthWrite: false }));
    this.engagedRing.rotation.x = -Math.PI / 2;
    this.engagedRing.position.y = 0.085;
    this.engagedRing.visible = false;
    const hit = mesh(G.hit, hitMat, 0, 0.5, 0, false);
    hit.visible = false; // raycast only, never drawn
    this.group.add(this.ring, this.engagedRing, hit);

    if (t.kind === "feature") {
      const [c, e] = CRYSTAL_COLORS[t.severity] ?? CRYSTAL_COLORS[1];
      this.skin = new THREE.MeshLambertMaterial({ color: c, emissive: e, flatShading: true });
      const parts: [number, number, number, number, number][] = [[0, 0, 1.0, 2.2, 0], [0.16, 0.08, 0.65, 1.4, 0.35], [-0.14, 0.1, 0.55, 1.2, -0.4], [0.02, -0.16, 0.5, 1.0, 0.2]];
      for (const [x, z, s, sy, tilt] of parts) {
        const m = mesh(G.crystal, this.skin, x, 0.2 * sy * s, z);
        m.scale.set(s, s * sy, s);
        m.rotation.z = tilt;
        this.body.add(m);
      }
    } else {
      this.skin = new THREE.MeshLambertMaterial({ color: BUG_COLORS[t.severity] ?? BUG_COLORS[2], flatShading: true });
      const b = mesh(G.body, this.skin, 0, 0.27, 0);
      b.scale.set(1, 0.85, 1);
      this.body.add(b);
      const white = mat("#ffffff"), black = mat("#111111");
      for (const x of [-0.1, 0.1]) {
        this.body.add(mesh(G.eye, white, x, 0.36, 0.24, false), mesh(G.pupil, black, x, 0.36, 0.29, false));
      }
      if (t.severity >= 2) {
        for (const x of [-0.14, 0.14]) {
          const h = mesh(G.horn, mat("#efe3c8"), x, 0.55, 0.02);
          h.rotation.z = -x * 2.5;
          this.body.add(h);
        }
      }
      if (t.severity >= 3) {
        for (const x of [-0.07, 0, 0.07]) {
          const tooth = mesh(G.tooth, mat("#ffffff"), x, 0.2, 0.27, false);
          tooth.rotation.x = Math.PI;
          this.body.add(tooth);
        }
      }
      // Face the camera (which sits south-east)
      this.body.rotation.y = Math.PI / 4;
    }
    this.body.scale.setScalar(this.size);
    this.group.add(this.body);

    // White flag for resolved targets
    this.flag = new THREE.Group();
    this.flag.add(mesh(G.flagPole, mat("#5a3d22"), 0, 0.4, 0), mesh(G.flag, mat("#f4f1e6"), 0.15, 0.68, 0));
    this.flag.position.set(0.25, 0, -0.1);
    this.flag.visible = false;
    this.group.add(this.flag);

    // Battle smoke while engaged
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(G.puff, new THREE.MeshLambertMaterial({ color: "#5a5550", transparent: true, opacity: 0, depthWrite: false }));
      m.userData.phase = i / 5;
      m.visible = false;
      this.puffs.push(m);
      this.group.add(m);
    }

    this.tag = makeLabel(t.issue, { height: 0.24, font: 36 });
    this.tag.position.y = 0.8 * this.size + 0.25;
    this.group.add(this.tag);

    this.update(t);
  }

  update(t: Target) {
    this.target = t;
    this.group.position.copy(tileToWorld(t.pos.x, t.pos.y));
    const resolved = t.status === "resolved";
    this.flag.visible = resolved;
    this.engagedRing.visible = t.status === "engaged";
    for (const p of this.puffs) p.visible = t.status === "engaged";
    if (this.skin.transparent !== resolved) {
      this.skin.transparent = resolved;
      this.skin.opacity = resolved ? 0.55 : 1;
      this.skin.needsUpdate = true;
    }
    if (t.kind === "feature") {
      const [c, e] = CRYSTAL_COLORS[t.severity] ?? CRYSTAL_COLORS[1];
      this.skin.color.set(resolved ? GREY : c);
      this.skin.emissive.set(resolved ? "#222222" : e);
    } else {
      this.skin.color.set(resolved ? GREY : BUG_COLORS[t.severity] ?? BUG_COLORS[2]);
    }
    (this.tag.material as THREE.SpriteMaterial).opacity = resolved ? 0.5 : 1;
  }

  setSelected(on: boolean) { this.selected = on; this.syncRing(); }
  setHovered(on: boolean) { this.hovered = on; this.syncRing(); }
  private syncRing() {
    this.ring.visible = this.selected || this.hovered;
    const m = this.ring.material as THREE.MeshBasicMaterial;
    m.color.set(this.selected ? "#f2e27a" : "#ffffff");
    m.opacity = this.selected ? 0.95 : 0.45;
  }

  /** Order acknowledged: flash the target green (AoE style). */
  orderFlash() { this.flash = 1.2; }

  tick(t: number, dt: number) {
    const st = this.target.status;
    const s = this.size;
    if (st === "resolved") {
      this.body.scale.set(s, s * 0.55, s);
      this.body.position.y = 0;
    } else if (this.target.kind === "feature") {
      this.body.rotation.y += dt * (st === "engaged" ? 1.6 : 0.4);
      this.body.position.y = 0.05 + Math.sin(t * 1.5 + this.phase) * 0.04;
    } else {
      const k = st === "engaged" ? 9 : 2.6;
      const sq = Math.sin(t * k + this.phase);
      this.body.scale.set(s * (1 + sq * 0.05), s * (1 - sq * 0.07), s * (1 + sq * 0.05));
      this.body.position.y = st === "engaged" ? Math.abs(sq) * 0.05 : 0;
      this.body.rotation.y = Math.PI / 4 + (st === "engaged" ? Math.sin(t * 17) * 0.12 : 0);
    }
    if (this.engagedRing.visible) {
      const p = (t * 0.9 + this.phase) % 1;
      this.engagedRing.scale.setScalar(s * (0.8 + p * 0.6));
      (this.engagedRing.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - p);
    }
    if (st === "engaged") {
      for (const m of this.puffs) {
        const ph = (t * 0.45 + m.userData.phase) % 1;
        const a = m.userData.phase * Math.PI * 2;
        m.position.set(Math.cos(a) * 0.25 * s + ph * 0.2, 0.3 + ph * 1.3 * s, Math.sin(a) * 0.25 * s - ph * 0.1);
        m.scale.setScalar((0.6 + ph * 1.8) * s);
        (m.material as THREE.MeshLambertMaterial).opacity = 0.55 * (1 - ph) * Math.min(1, ph * 5);
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt);
      const on = Math.floor(this.flash * 8) % 2 === 0;
      this.ring.visible = on || this.selected || this.hovered;
      (this.ring.material as THREE.MeshBasicMaterial).color.set(on ? "#6dff5a" : this.selected ? "#f2e27a" : "#ffffff");
      if (this.flash === 0) this.syncRing();
    }
  }

  dispose() {
    this.skin.dispose();
    for (const p of this.puffs) (p.material as THREE.Material).dispose();
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
    (this.ring.material as THREE.Material).dispose();
    (this.engagedRing.material as THREE.Material).dispose();
  }
}
