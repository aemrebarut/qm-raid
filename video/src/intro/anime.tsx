// Anime grammar helpers for the intro: palette, springs, shake, speed lines,
// impact flashes, sparkles, halftone and slammed title cards. Code-drawn only.
import React from "react";
import {AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig} from "remotion";

export const C = {
  gold: "#d9a441",
  goldHi: "#f3c969",
  bronze: "#8c7a5a",
  bronzeLo: "#3b3326",
  bronzeHi: "#c8ad7a",
  ink: "#ece6d8",
  stone: "#1b1712",
  stone2: "#2a241c",
  recall: "#6fa8ff",
  river: "#4fa7e0",
  remember: "#e0b454",
  ok: "#7cc47f",
  danger: "#d65a45",
  red: "#d64545",
  blue: "#3f7fd6",
  violet: "#b08ce8",
  line: "#24170d",
};

export const FONT_HEAD = '"Avenir Next Condensed", "DIN Condensed", Impact, sans-serif';
export const FONT_BODY = '-apple-system, "SF Pro Text", system-ui, sans-serif';

// Overshooting slam spring, 0 before `at`, settles to 1.
export const slam = (frame: number, fps: number, at: number, damping = 12) =>
  spring({frame: frame - at, fps, config: {damping, stiffness: 240, mass: 0.7}});

// Decaying random shake summed over hit frames.
export const shakeAt = (frame: number, hits: number[], amp = 18, len = 10) => {
  let x = 0;
  let y = 0;
  for (const h of hits) {
    const t = frame - h;
    if (t >= 0 && t < len) {
      const d = 1 - t / len;
      x += (random(`sx-${h}-${t}`) * 2 - 1) * amp * d;
      y += (random(`sy-${h}-${t}`) * 2 - 1) * amp * d;
    }
  }
  return {x, y};
};

// Impact frame: inverted, high contrast ink for `len` frames.
export const impactFilter = (frame: number, hits: number[], len = 3) =>
  hits.some((h) => frame >= h && frame < h + len) ? "invert(1) grayscale(1) contrast(4)" : "none";

export const Camera: React.FC<{
  hits?: number[];
  amp?: number;
  zoom?: number;
  impacts?: number[];
  origin?: string;
  children: React.ReactNode;
}> = ({hits = [], amp = 18, zoom = 1, impacts = [], origin = "50% 50%", children}) => {
  const frame = useCurrentFrame();
  const s = shakeAt(frame, hits, amp);
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${s.x}px, ${s.y}px) scale(${zoom})`,
        transformOrigin: origin,
        filter: impactFilter(frame, impacts),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const Flash: React.FC<{at: number; len?: number; color?: string; peak?: number}> = ({
  at,
  len = 3,
  color = "#fff",
  peak = 1,
}) => {
  const frame = useCurrentFrame();
  if (frame < at || frame >= at + len) return null;
  const o = interpolate(frame, [at, at + len], [peak, 0]);
  return <AbsoluteFill style={{background: color, opacity: o}} />;
};

// Radial speed lines converging on (cx, cy); re-seeded every 2 frames for flicker.
export const RadialLines: React.FC<{
  color?: string;
  count?: number;
  inner?: number;
  opacity?: number;
  cx?: number;
  cy?: number;
  seed?: string;
  spin?: number;
}> = ({color = "#fff", count = 90, inner = 380, opacity = 0.8, cx = 960, cy = 540, seed = "r", spin = 0}) => {
  const frame = useCurrentFrame();
  const tick = Math.floor(frame / 2);
  const R = 1600;
  const polys: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (random(`${seed}-a-${i}-${tick}`) - 0.5) * 0.06 + spin * frame;
    const w = 0.003 + random(`${seed}-w-${i}-${tick}`) * 0.012;
    const r0 = inner + random(`${seed}-r-${i}-${tick}`) * 280;
    const p0 = `${cx + Math.cos(a) * r0},${cy + Math.sin(a) * r0}`;
    const p1 = `${cx + Math.cos(a - w) * R},${cy + Math.sin(a - w) * R}`;
    const p2 = `${cx + Math.cos(a + w) * R},${cy + Math.sin(a + w) * R}`;
    polys.push(<polygon key={i} points={`${p0} ${p1} ${p2}`} fill={color} />);
  }
  return (
    <AbsoluteFill>
      <svg width={1920} height={1080} style={{opacity}}>
        {polys}
      </svg>
    </AbsoluteFill>
  );
};

// Horizontal motion streaks sweeping in `dir` (-1 = to the left).
export const HLines: React.FC<{
  color?: string;
  count?: number;
  speed?: number;
  opacity?: number;
  seed?: string;
  dir?: 1 | -1;
}> = ({color = "#fff", count = 40, speed = 70, opacity = 0.35, seed = "h", dir = -1}) => {
  const frame = useCurrentFrame();
  const rects: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const y = random(`${seed}-y-${i}`) * 1080;
    const len = 200 + random(`${seed}-l-${i}`) * 700;
    const th = 2 + random(`${seed}-t-${i}`) * 7;
    const v = speed * (0.6 + random(`${seed}-v-${i}`) * 0.9);
    const span = 1920 + len + 400;
    const x0 = random(`${seed}-x-${i}`) * span;
    const raw = (((x0 + dir * frame * v) % span) + span) % span;
    rects.push(<rect key={i} x={raw - len - 200} y={y} width={len} height={th} rx={th / 2} fill={color} />);
  }
  return (
    <AbsoluteFill>
      <svg width={1920} height={1080} style={{opacity}}>
        {rects}
      </svg>
    </AbsoluteFill>
  );
};

export const starPath = (s: number) => `M0,${-s} Q0,0 ${s},0 Q0,0 0,${s} Q0,0 ${-s},0 Q0,0 0,${-s} Z`;

export const Star: React.FC<{x: number; y: number; s: number; color?: string; rot?: number; opacity?: number}> = ({
  x,
  y,
  s,
  color = "#fff",
  rot = 0,
  opacity = 1,
}) => <path d={starPath(s)} transform={`translate(${x},${y}) rotate(${rot})`} fill={color} opacity={opacity} />;

// Twinkling 4 point stars at seeded spots inside a box.
export const Sparkles: React.FC<{
  count?: number;
  seed?: string;
  color?: string;
  box?: [number, number, number, number];
  size?: number;
  start?: number;
}> = ({count = 24, seed = "sp", color = "#fff", box = [0, 0, 1920, 1080], size = 22, start = 0}) => {
  const frame = useCurrentFrame();
  const stars: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const x = box[0] + random(`${seed}-x-${i}`) * box[2];
    const y = box[1] + random(`${seed}-y-${i}`) * box[3];
    const ph = random(`${seed}-p-${i}`) * 20;
    const t = frame - start + ph;
    if (t < 0) continue;
    const k = Math.max(0, Math.sin(t * 0.3));
    const s = size * (0.5 + random(`${seed}-s-${i}`)) * k;
    if (s < 0.5) continue;
    stars.push(<Star key={i} x={x} y={y} s={s} color={color} rot={t * 3} />);
  }
  return (
    <AbsoluteFill>
      <svg width={1920} height={1080}>{stars}</svg>
    </AbsoluteFill>
  );
};

export const Halftone: React.FC<{color?: string; size?: number; opacity?: number; dot?: number}> = ({
  color = "rgba(0,0,0,0.35)",
  size = 18,
  opacity = 1,
  dot = 3,
}) => (
  <AbsoluteFill
    style={{
      opacity,
      backgroundImage: `radial-gradient(circle, ${color} ${dot}px, transparent ${dot + 0.6}px)`,
      backgroundSize: `${size}px ${size}px`,
      WebkitMaskImage: "radial-gradient(ellipse at center, transparent 35%, black 95%)",
      maskImage: "radial-gradient(ellipse at center, transparent 35%, black 95%)",
    }}
  />
);

export const Vignette: React.FC<{strength?: number}> = ({strength = 0.45}) => (
  <AbsoluteFill
    style={{background: `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,${strength}) 100%)`}}
  />
);

// Shared SVG gradients and glow filters (identical in every SVG that includes them).
export const Defs: React.FC = () => (
  <defs>
    <linearGradient id="g-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#fff6cf" />
      <stop offset="0.38" stopColor={C.goldHi} />
      <stop offset="0.62" stopColor={C.gold} />
      <stop offset="1" stopColor="#9c6419" />
    </linearGradient>
    <linearGradient id="g-red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#ffe0d4" />
      <stop offset="0.4" stopColor="#ff7a5c" />
      <stop offset="1" stopColor="#a8251a" />
    </linearGradient>
    <linearGradient id="g-blue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#e8f5ff" />
      <stop offset="0.4" stopColor="#8cc8ff" />
      <stop offset="1" stopColor="#2a6fc0" />
    </linearGradient>
    <radialGradient id="g-window">
      <stop offset="0" stopColor="#eaf6ff" />
      <stop offset="0.45" stopColor={C.recall} />
      <stop offset="1" stopColor="#24509e" />
    </radialGradient>
    <radialGradient id="g-river">
      <stop offset="0" stopColor="#ffffff" />
      <stop offset="0.35" stopColor="#bfe6ff" />
      <stop offset="0.7" stopColor={C.river} />
      <stop offset="1" stopColor="#1d5f96" />
    </radialGradient>
    <radialGradient id="g-orb">
      <stop offset="0" stopColor="#fffbe8" />
      <stop offset="0.4" stopColor="#ffe08a" />
      <stop offset="1" stopColor={C.remember} />
    </radialGradient>
    <linearGradient id="g-plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#3a3226" />
      <stop offset="1" stopColor={C.stone} />
    </linearGradient>
    <filter id="f-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="10" result="b" />
      <feMerge>
        <feMergeNode in="b" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
    <filter id="f-blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="14" />
    </filter>
  </defs>
);

type Fill = "gold" | "red" | "blue";

// A slammed, skewed title line with brown outline and hard shadow.
export const TitleLine: React.FC<{
  text: string;
  at: number;
  x?: number;
  y: number;
  size?: number;
  fill?: Fill;
  skew?: number;
}> = ({text, at, x = 960, y, size = 140, fill = "gold", skew = -8}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (frame < at) return null;
  const s = slam(frame, fps, at, 11);
  const sc = interpolate(s, [0, 1], [2.8, 1]);
  const rot = interpolate(s, [0, 1], [-7, 0]);
  const common = {
    textAnchor: "middle" as const,
    fontFamily: FONT_HEAD,
    fontWeight: 900,
    fontSize: size,
    stroke: C.line,
    strokeWidth: size * 0.1,
    strokeLinejoin: "round" as const,
    style: {letterSpacing: size * 0.02},
  };
  return (
    <g transform={`translate(${x},${y}) rotate(${rot}) scale(${sc}) skewX(${skew})`}>
      <text {...common} x={9} y={9} fill={C.line}>
        {text}
      </text>
      <text {...common} x={0} y={0} fill={`url(#g-${fill})`} paintOrder="stroke">
        {text}
      </text>
    </g>
  );
};

export const Title: React.FC<{
  lines: {text: string; fill?: Fill}[];
  at: number;
  y?: number;
  size?: number;
  gap?: number;
  stagger?: number;
  x?: number;
}> = ({lines, at, y = 170, size = 140, gap, stagger = 9, x = 960}) => (
  <AbsoluteFill>
    {lines.map((l, i) => (
      <Flash key={`f${i}`} at={at + i * stagger} len={1} peak={0.7} />
    ))}
    <svg width={1920} height={1080} style={{overflow: "visible"}}>
      <Defs />
      {lines.map((l, i) => (
        <TitleLine
          key={i}
          text={l.text}
          fill={l.fill}
          at={at + i * stagger}
          x={x + i * 30}
          y={y + i * (gap ?? size * 0.95)}
          size={size}
        />
      ))}
    </svg>
  </AbsoluteFill>
);

// Spark burst from a point: short streaks with gravity, `life` frames long.
export const Sparks: React.FC<{at: number; x: number; y: number; seed: string; count?: number; life?: number; colors?: string[]; power?: number}> = ({
  at,
  x,
  y,
  seed,
  count = 30,
  life = 20,
  colors = ["#ffffff", C.river, C.goldHi],
  power = 1,
}) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t > life) return null;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI * (0.05 + random(`${seed}-a-${i}`) * 0.9);
    const v = (14 + random(`${seed}-v-${i}`) * 26) * power;
    const vx = Math.cos(a) * v;
    const vy = Math.sin(a) * v;
    const px = x + vx * t;
    const py = y + vy * t + 0.9 * t * t;
    const dx = vx;
    const dy = vy + 1.8 * t;
    const n = Math.hypot(dx, dy) || 1;
    const L = 26 * (1 - t / life);
    out.push(
      <line
        key={i}
        x1={px}
        y1={py}
        x2={px - (dx / n) * L}
        y2={py - (dy / n) * L}
        stroke={colors[i % colors.length]}
        strokeWidth={5 * (1 - t / life) + 1}
        strokeLinecap="round"
      />,
    );
  }
  return <g>{out}</g>;
};
