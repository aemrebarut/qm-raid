// Scale reference (raid-art-plan): a 0.8 tall board-unit silhouette at scale 1 and at the board's 1.5,
// next to a 3 x 3 building footprint outline, so every asset can be judged against the board.
import * as THREE from "three";
import type { Exhibit } from "../../src/types";
import { unitPortrait } from "../../src/portrait";

const ref = new THREE.MeshLambertMaterial({ color: "#c9c2b0", transparent: true, opacity: 0.55 });

function dummy(scale: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.48, 8), ref);
  body.position.y = 0.24;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), ref);
  head.position.y = 0.66;
  g.add(body, head);
  g.scale.setScalar(scale);
  return g;
}

const exhibits: Exhibit[] = [
  {
    name: "Scale reference",
    area: "lighting",
    span: 3,
    make() {
      const g = new THREE.Group();
      const a = dummy(1); a.position.x = -0.5;
      const b = dummy(1.5); b.position.x = 0.5;
      const fp = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(3, 0.02, 3)),
        new THREE.LineBasicMaterial({ color: "#f1e3bf" }),
      );
      fp.position.y = 0.01;
      g.add(a, b, fp);
      return { object3d: g };
    },
  },
  {
    name: "HUD portraits (unitPortrait)",
    area: "lighting",
    span: 4,
    turntable: false,
    make() {
      // Sprites of the PNG data URLs the HUD gets: bust per class in red, blue and neutral, plus one full shot.
      const g = new THREE.Group();
      const specs: [string, string | null, boolean][] = [["knight", "#d64545", false], ["ranger", "#3f73b8", false], ["scout", "#d64545", false], ["oracle", null, false], ["forge-triage", "#3f73b8", true]];
      const loader = new THREE.TextureLoader();
      specs.forEach(([cls, color, forged], i) => {
        const url = unitPortrait({ cls, teamColor: color, forged, size: 128, background: "#2b2a26" });
        const tex = loader.load(url);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
        sp.scale.set(0.7, 0.7, 1);
        sp.position.set(-1.4 + i * 0.72, 0.5, 0);
        g.add(sp);
      });
      const full = new THREE.Sprite(new THREE.SpriteMaterial({ map: loader.load(unitPortrait({ cls: "knight", teamColor: "#d64545", size: 128, shot: "full", anim: "cast" })) }));
      full.scale.set(1, 1, 1);
      full.position.set(0, 1.4, 0);
      g.add(full);
      return { object3d: g };
    },
  },
];
export default exhibits;
