// Unit portraits: a bust rendered from the unit's real 3D model (packages/art unitPortrait, cached per class,
// team colour and size, one shared offscreen renderer). Same flag as the scene's unit bodies (artOn('units')),
// so the portrait always matches what is on the map; otherwise, or if rendering fails, an SVG class crest.
import { unitPortrait } from "../../../../packages/art/src";
import { artOn } from "../scene/art";
import { classIcon, icon } from "./icons";

const BUILTIN = new Set(["knight", "ranger", "scout", "oracle"]);
let broken = false;

/** Children for a .hud-portrait box of about px CSS pixels: an <img> of the model, or the crest icon. */
export function portraitArt(cls: string, teamColor: string | null | undefined, px: number): Element {
  if (!broken && artOn("units")) {
    try {
      const src = unitPortrait({
        cls, teamColor: teamColor ?? null, forged: !BUILTIN.has(cls),
        size: Math.round(px * Math.min(2, window.devicePixelRatio || 1)), background: null,
      });
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.draggable = false;
      return img;
    } catch {
      broken = true; // no WebGL for a second context: crests from now on
    }
  }
  return icon(classIcon(cls));
}
