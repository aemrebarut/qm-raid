// Procedural canvas textures for effects: soft glow, rune glyphs, dust puff, dashed ring, contact shadow.
// Everything is drawn once and cached; no image files.
import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

function canvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = false) {
  let t = cache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** White radial glow, tint with material colour; additive blending. */
export function glowTexture() {
  return canvasTex("glow", 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(255,255,255,0.6)");
    g.addColorStop(0.65, "rgba(255,255,255,0.15)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

/** Soft round puff with a lit top, for dust and smoke (normal blending). */
export function puffTexture() {
  return canvasTex("puff", 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(28, 26, 2, 32, 32, 31);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.55, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

/**
 * A 4 x 2 atlas of original rune glyphs (straight strokes, runic feel, not any real alphabet).
 * Use with uv offset (col / 4, row / 2) and repeat (1/4, 1/2).
 */
export function runeAtlas() {
  return canvasTex("runes", 256, 128, (ctx) => {
    ctx.strokeStyle = "#ffffff";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 6;
    ctx.lineWidth = 5;
    const glyphs: number[][][] = [
      [[0, -1, 0, 1], [0, -0.3, 0.6, -0.9], [0, 0.1, 0.6, -0.5]],
      [[-0.4, -1, -0.4, 1], [-0.4, -1, 0.5, -0.2], [0.5, -0.2, -0.4, 0.4]],
      [[0, -1, 0, 1], [-0.6, -0.5, 0.6, 0.5], [0.6, -0.5, -0.6, 0.5]],
      [[-0.5, 1, 0, -1], [0, -1, 0.5, 1], [-0.3, 0.2, 0.3, 0.2]],
      [[-0.5, -1, -0.5, 1], [0.5, -1, 0.5, 1], [-0.5, 0, 0.5, -0.6]],
      [[0, -1, 0.6, 0], [0.6, 0, 0, 1], [0, 1, -0.6, 0], [-0.6, 0, 0, -1]],
      [[0, -1, 0, 1], [0, -1, 0.6, -0.4], [0, 0.2, -0.6, 0.8]],
      [[-0.6, -1, 0.6, 1], [-0.6, 1, 0.6, -1], [-0.6, -1, 0.6, -1]],
    ];
    glyphs.forEach((lines, i) => {
      const cx = (i % 4) * 64 + 32, cy = Math.floor(i / 4) * 64 + 32, s = 22;
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of lines) {
        ctx.moveTo(cx + x0 * s, cy + y0 * s);
        ctx.lineTo(cx + x1 * s, cy + y1 * s);
      }
      ctx.stroke();
    });
  });
}

/** Rune circle for the ground under a casting unit: two rings, ticks and eight glyph slots. */
export function runeCircleTexture() {
  return canvasTex("runeCircle", 256, 256, (ctx) => {
    ctx.translate(128, 128);
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 8;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, 118, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 92, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 44, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, r0 = i % 6 === 0 ? 92 : 104;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * 116, Math.sin(a) * 116);
      ctx.stroke();
    }
    // Hexagram-like star joining the inner ring (original, simple geometry)
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = (i / 3) * Math.PI * 2 + k * Math.PI / 3 - Math.PI / 2;
        const x = Math.cos(a) * 88, y = Math.sin(a) * 88;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      ctx.beginPath(); ctx.arc(Math.cos(a) * 68, Math.sin(a) * 68, 5, 0, Math.PI * 2); ctx.fill();
    }
  });
}

/** Dashed selection ring (AoE style), white; tint with material colour. */
export function dashedRingTexture() {
  return canvasTex("dashRing", 128, 128, (ctx) => {
    ctx.translate(64, 64);
    ctx.strokeStyle = "#ffffff";
    ctx.lineCap = "round";
    ctx.lineWidth = 7;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = a0 + (Math.PI * 2 / n) * 0.62;
      ctx.beginPath(); ctx.arc(0, 0, 54, a0, a1); ctx.stroke();
    }
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.stroke();
  });
}

/** Solid soft ring used by pings and pulses. */
export function softRingTexture() {
  return canvasTex("softRing", 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 30, 64, 64, 63);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.7, "rgba(255,255,255,0.25)");
    g.addColorStop(0.86, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

/** Chevron pointing down (order ping arrows), white. */
export function chevronTexture() {
  return canvasTex("chevron", 64, 64, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(8, 14); ctx.lineTo(32, 38); ctx.lineTo(56, 14); ctx.lineTo(56, 28); ctx.lineTo(32, 52); ctx.lineTo(8, 28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
}

/** Dark radial blob for fake contact shadows / ambient occlusion under objects. */
export function contactShadowTexture() {
  return canvasTex("contact", 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.5, "rgba(0,0,0,0.3)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

/** Parchment page icon with blue border (recall pages). */
export function pageTexture() {
  return canvasTex("page", 48, 60, (ctx) => {
    ctx.fillStyle = "#f4e7c4";
    ctx.strokeStyle = "#2f6fb8";
    ctx.lineWidth = 4;
    ctx.fillRect(4, 4, 40, 52);
    ctx.strokeRect(4, 4, 40, 52);
    ctx.fillStyle = "#7a6440";
    for (let i = 0; i < 5; i++) ctx.fillRect(10, 14 + i * 8, i === 4 ? 16 : 28, 3);
  }, true);
}

/** Victory banner cloth: team colour field with a gold laurel-ish chevron, drawn white-on-colour. */
export function bannerTexture(color: string) {
  return canvasTex(`banner:${color}`, 64, 96, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 64, 96);
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, "rgba(0,0,0,0.25)");
    g.addColorStop(0.5, "rgba(255,255,255,0.08)");
    g.addColorStop(1, "rgba(0,0,0,0.2)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 96);
    ctx.strokeStyle = "#f2cf5b";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 56, 88);
    ctx.fillStyle = "#f2cf5b";
    ctx.beginPath();
    ctx.moveTo(32, 22); ctx.lineTo(46, 44); ctx.lineTo(32, 38); ctx.lineTo(18, 44); ctx.closePath();
    ctx.fill();
    ctx.beginPath(); ctx.arc(32, 60, 8, 0, Math.PI * 2); ctx.fill();
  }, true);
}
