// @qm-raid/art: procedural low-poly Three.js asset factories for the board. No game logic, three only.
// Board usage: import { makeUnit, makeBuilding, ... } from "../../../../packages/art/src";
// Each area file is re-exported here once it lands (raid-art-plan adds the line).
export type * from "./types";

// units (raid-art-units)
export { makeUnit, typeColor, UNIT_CLASSES, UNIT_ANIMS, type UnitHandle, type BuiltinClass } from "./units";
export { makeTarget } from "./monsters";

// buildings (raid-art-world)
export { makeBuilding } from "./world/buildings";
export { makeTerrain, type TerrainArt } from "./world/terrain";
export { makeZones, type ZonesArt, type ZonesOpts } from "./world/zones";

// lighting and effects (raid-art-fx)
export { lighting, removeLights, contactShadow, type LightingRig, type ArtLightingOpts } from "./lighting";
export { ArtFx, SelectionRing, FX_COLORS, type Pt } from "./fx/fx";

// HUD portraits from the real unit model (raid-art-plan)
export { unitPortrait, disposePortraits, type PortraitOpts } from "./portrait";
