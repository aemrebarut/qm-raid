// Chibi knight mascot that pops in from a corner and reacts: cheer, shock, smug, think. Code-drawn SVG,
// thick warm-brown outline, flat cel shading (art direction in video/src/intro/STORYBOARD.md).
import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { FX, HEAD, fadeOut, useLocal, usePop } from "./theme";

export type Mood = "cheer" | "shock" | "smug" | "think";
export type MascotProps = {
  from: number;
  duration?: number; // default 60
  mood?: Mood;
  corner?: "bl" | "br" | "tl" | "tr"; // default "bl"
  say?: string; // speech bubble text
  size?: number; // px height (default 260)
};

const O = FX.outline;

const Face: React.FC<{ mood: Mood; f: number }> = ({ mood, f }) => {
  const blink = f % 50 > 46;
  if (mood === "cheer")
    return (
      <g stroke={O} strokeWidth={5} fill="none" strokeLinecap="round">
        <path d="M-34 -2 q10 -14 20 0" />
        <path d="M14 -2 q10 -14 20 0" />
        <path d="M-16 18 q16 22 32 0 z" fill="#8e2e20" />
      </g>
    );
  if (mood === "shock")
    return (
      <g stroke={O} strokeWidth={5}>
        <circle cx={-24} cy={-2} r={13} fill="#fff" />
        <circle cx={24} cy={-2} r={13} fill="#fff" />
        <circle cx={-24} cy={-2} r={4} fill={O} />
        <circle cx={24} cy={-2} r={4} fill={O} />
        <ellipse cx={0} cy={28} rx={9} ry={12} fill="#8e2e20" />
        <path d="M46 -34 q8 14 0 20 q-8 -6 0 -20 z" fill="#9cc4ff" strokeWidth={3} />
      </g>
    );
  if (mood === "smug")
    return (
      <g stroke={O} strokeWidth={5} fill="none" strokeLinecap="round">
        <path d="M-36 -4 h22" />
        <path d="M14 -4 h22" />
        <path d="M-12 20 q14 10 28 -6" />
      </g>
    );
  return (
    <g stroke={O} strokeWidth={5} strokeLinecap="round">
      {blink ? <path d="M-34 -2 h20 M14 -2 h20" fill="none" /> : (
        <>
          <ellipse cx={-24} cy={-2} rx={8} ry={11} fill={O} />
          <ellipse cx={24} cy={-2} rx={8} ry={11} fill={O} />
          <circle cx={-21} cy={-6} r={3} fill="#fff" stroke="none" />
          <circle cx={27} cy={-6} r={3} fill="#fff" stroke="none" />
        </>
      )}
      <path d="M-8 24 h16" fill="none" />
    </g>
  );
};

export const Mascot: React.FC<MascotProps> = ({ from, duration = 60, mood = "cheer", corner = "bl", say, size = 300 }) => {
  const f = useLocal(from, duration);
  const pop = usePop(f ?? 0, 0, 10, 200);
  const bubble = usePop(f ?? 0, 8, 11, 220);
  if (f === null) return null;
  const left = corner.endsWith("l");
  const top = corner.startsWith("t");
  const hop = mood === "cheer" ? -Math.abs(Math.sin(f / 4)) * 22 : mood === "shock" ? (f < 10 ? -Math.sin(f / 1.5) * 10 : 0) : Math.sin(f / 8) * 5;
  // Staff angle: 0 is straight up (raised), positive tilts it outward and down.
  const armUp = mood === "cheer" ? -8 + Math.sin(f / 3) * 18 : mood === "shock" ? 55 : mood === "think" ? 18 : 30;
  const slide = interpolate(pop, [0, 1], [left ? -size : size, 0]);
  const scale = size / 260;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: fadeOut(f, duration) }}>
      <div
        style={{
          position: "absolute", [left ? "left" : "right"]: 40, [top ? "top" : "bottom"]: 30, width: 240 * scale, height: 260 * scale,
          transform: `translate(${slide}px, ${hop}px) scaleX(${left ? 1 : -1})`,
        }}
      >
        <svg width={240 * scale} height={260 * scale} viewBox="-120 -150 240 260" style={{ overflow: "visible" }}>
          <ellipse cx={0} cy={104} rx={62} ry={10} fill="rgba(0,0,0,.35)" />
          {/* body and cape */}
          <path d="M-52 40 q-10 50 -6 62 h116 q4 -12 -6 -62 z" fill="#b8423a" stroke={O} strokeWidth={6} strokeLinejoin="round" />
          <rect x={-40} y={36} width={80} height={62} rx={18} fill="#9aa3ad" stroke={O} strokeWidth={6} />
          <rect x={-40} y={70} width={80} height={10} fill={FX.gold} stroke={O} strokeWidth={4} />
          {/* arm with staff */}
          <g transform={`translate(38 52) rotate(${armUp})`}>
            <line x1={0} y1={0} x2={0} y2={-100} stroke={O} strokeWidth={14} strokeLinecap="round" />
            <line x1={0} y1={0} x2={0} y2={-100} stroke="#8c5a2b" strokeWidth={7} strokeLinecap="round" />
            <circle cx={0} cy={-108} r={13} fill={mood === "cheer" ? FX.goldHi : FX.recall} stroke={O} strokeWidth={5} />
            <circle cx={0} cy={0} r={13} fill="#9aa3ad" stroke={O} strokeWidth={5} />
          </g>
          {/* shield arm */}
          <g transform={`translate(-46 60) rotate(${mood === "shock" ? 30 : 0})`}>
            <path d="M-24 -26 h48 v24 q0 26 -24 36 q-24 -10 -24 -36 z" fill={FX.gold} stroke={O} strokeWidth={6} strokeLinejoin="round" />
            <path d="M0 -18 v40 M-14 -4 h28" stroke={FX.outline} strokeWidth={5} />
          </g>
          {/* head: helmet with open visor, plume */}
          <g transform={`rotate(${mood === "think" ? -8 : mood === "smug" ? 6 : 0})`}>
            <path d="M8 -128 q30 -26 52 -6 q-22 -2 -30 18 z" fill="#d64545" stroke={O} strokeWidth={6} strokeLinejoin="round" />
            <circle cx={0} cy={-38} r={78} fill="#b9c1ca" stroke={O} strokeWidth={7} />
            <path d="M-70 -54 q70 -60 140 0" fill="none" stroke="#dfe5ea" strokeWidth={8} strokeLinecap="round" />
            <rect x={-58} y={-44} width={116} height={78} rx={30} fill="#f3d2b3" stroke={O} strokeWidth={6} />
            <ellipse cx={-38} cy={10} rx={10} ry={6} fill="#f0a698" />
            <ellipse cx={38} cy={10} rx={10} ry={6} fill="#f0a698" />
            <g transform="translate(0 -10)">
              <Face mood={mood} f={f} />
            </g>
          </g>
          {mood === "think" ? <text x={70} y={-120} fontFamily={HEAD} fontWeight={900} fontSize={44} fill={FX.ink} stroke={O} strokeWidth={3}>{".".repeat(1 + (Math.floor(f / 8) % 3))}</text> : null}
        </svg>
      </div>
      {mood === "shock" ? (
        <div
          style={{
            position: "absolute", [left ? "left" : "right"]: 40 + 150 * scale, [top ? "top" : "bottom"]: 30 + 205 * scale,
            transform: `rotate(${left ? 12 : -12}deg) scale(${bubble})`, fontFamily: HEAD, fontWeight: 900, fontSize: 84 * scale,
            color: FX.danger, WebkitTextStroke: `5px ${O}`, paintOrder: "stroke fill", textShadow: `0 5px 0 ${O}`,
          }}
        >
          !?
        </div>
      ) : null}
      {say ? (
        <div
          style={{
            position: "absolute", [left ? "left" : "right"]: 40 + 200 * scale, [top ? "top" : "bottom"]: 30 + 180 * scale,
            transform: `scale(${bubble})`, transformOrigin: left ? "left bottom" : "right bottom",
            padding: "12px 22px", borderRadius: 22, background: FX.ink, border: `5px solid ${O}`, boxShadow: `0 6px 0 ${O}`,
            fontFamily: HEAD, fontWeight: 900, fontSize: 40, color: O, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.03em",
          }}
        >
          {say}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
