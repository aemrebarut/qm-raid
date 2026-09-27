// Monsters (raid-art-units): bug camps and feature sites for severity 1..4, with state buttons, hit and defeat.
import type { Exhibit } from "../../src/types";
import { makeTarget } from "../../src/monsters";

function one(kind: "bug" | "feature", severity: number): Exhibit {
  return {
    name: `${kind === "bug" ? "Bug camp" : "Feature site"} sev ${severity}`,
    area: "monsters",
    span: 2,
    make() {
      const m = makeTarget({ kind, severity, seed: severity * 13 });
      m.object3d.scale.setScalar(1.5); // the board shows camps at about unit scale
      let auto: number | null = null;
      const stopAuto = () => { if (auto !== null) clearInterval(auto); auto = null; };
      return {
        object3d: m.object3d,
        tick: (t, dt) => m.tick(t, dt),
        actions: {
          open: () => { stopAuto(); m.setState("open"); },
          engaged: () => { stopAuto(); m.setState("engaged"); },
          hit: () => m.hit(),
          "engaged + hits": () => { stopAuto(); m.setState("engaged"); auto = window.setInterval(() => m.hit(), 560); },
          defeat: () => { stopAuto(); m.defeat(); },
          resolved: () => { stopAuto(); m.setState("resolved"); },
        },
        dispose: () => { stopAuto(); m.dispose(); },
      };
    },
  };
}

const exhibits: Exhibit[] = [1, 2, 3, 4].flatMap((s) => [one("bug", s), one("feature", s)]);
export default exhibits;
