// World (raid-art-world): the three buildings with their effects, terrain, zones and props.
import type { Exhibit } from "../../src/types";
import { makeBuilding, type BuildingKind } from "../../src/world/buildings";

function building(kind: BuildingKind, title: string): Exhibit {
  return {
    name: `Building: ${title}`,
    area: "world",
    span: 3.5,
    make() {
      const b = makeBuilding(kind);
      let work = 0, working = false;
      return {
        object3d: b.object3d,
        tick(t, dt) {
          if (working) { work = (work + dt * 0.1) % 1; b.setWork(work); }
          b.tick(t, dt);
        },
        actions: {
          pulse: () => b.pulse(),
          "glow on": () => b.glow(true),
          "glow off": () => b.glow(false),
          ...(kind === "forge" ? { "work on": () => { working = true; }, "work off": () => { working = false; b.setWork(null); } } : {}),
        },
        dispose: () => b.dispose(),
      };
    },
  };
}

const exhibits: Exhibit[] = [
  building("library", "Library (GBrain)"),
  building("barracks", "Barracks"),
  building("forge", "Forge (River)"),
];
export default exhibits;
