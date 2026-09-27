// Units (raid-art-units): every class, each with a button per animation, plus a team line-up at board scale.
import * as THREE from "three";
import type { Exhibit } from "../../src/types";
import { makeUnit, UNIT_ANIMS, UNIT_CLASSES, type UnitHandle } from "../../src/units";

const TEAMS = ["#c0392b", "#2e6fd1", "#e2b23a", "#3f9b4a"];

function one(cls: string, forged = false): Exhibit {
  return {
    name: `Unit: ${cls}${forged ? " (forged)" : ""}`,
    area: "units",
    span: 2,
    make() {
      const u = makeUnit({ cls, teamColor: TEAMS[0], forged, seed: 7 });
      u.object3d.scale.setScalar(1.5); // board scale
      const actions: Record<string, () => void> = {};
      for (const a of UNIT_ANIMS) actions[a] = () => u.play(a);
      actions["glow recall"] = () => { u.play("cast"); u.setGlow("recall"); };
      actions["glow remember"] = () => { u.play("cast"); u.setGlow("remember"); };
      actions["glow off"] = () => u.setGlow(null);
      u.onStrike = () => {};
      return { object3d: u.object3d, tick: (t, dt) => u.tick(t, dt), actions, dispose: () => u.dispose() };
    },
  };
}

const lineup: Exhibit = {
  name: "Units: squad line-up (all anims)",
  area: "units",
  span: 4,
  turntable: false,
  make() {
    const g = new THREE.Group();
    const units: UnitHandle[] = [];
    const classes = [...UNIT_CLASSES, "forge-triage", "forge-docs"];
    classes.forEach((cls, i) => {
      for (let k = 0; k < 2; k++) {
        const u = makeUnit({ cls, teamColor: TEAMS[(i + k) % TEAMS.length], seed: i * 31 + k });
        u.object3d.scale.setScalar(1.5);
        u.object3d.position.set(-1.5 + (i % 3) * 1.2 + k * 0.5, 0, -1.4 + Math.floor(i / 3) * 1.5 + k * 0.45);
        u.play(UNIT_ANIMS[(i * 2 + k) % UNIT_ANIMS.length]);
        g.add(u.object3d);
        units.push(u);
      }
    });
    const actions: Record<string, () => void> = {};
    for (const a of UNIT_ANIMS) actions[`all ${a}`] = () => units.forEach((u) => u.play(a));
    return {
      object3d: g,
      tick: (t, dt) => units.forEach((u) => u.tick(t, dt)),
      actions,
      dispose: () => units.forEach((u) => u.dispose()),
    };
  },
};

const exhibits: Exhibit[] = [...UNIT_CLASSES.map((c) => one(c)), one("forge-triage"), one("forge-release-notes"), lineup];
export default exhibits;
