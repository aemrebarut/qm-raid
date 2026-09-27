// Score bar race: bars grow in turn and count up (default trained 0.82 vs base 0.42 on held-out orders);
// the leader gets a gold "WINNER" tag. Values are shown exactly as passed; pass only real numbers.
import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { SparkleBurst } from "./primitives";
import { FX, FxColor, HEAD, TONE, fadeOut, plate, useLocal, usePop } from "./theme";

export type ScoreRow = { label: string; value: number; tone?: FxColor };
export type ScoreRaceProps = {
  from: number;
  duration?: number; // default 90
  rows?: ScoreRow[];
  title?: string;
  x?: number; // top-left of the panel
  y?: number;
  width?: number; // default 820
  max?: number; // value of a full bar (default 1)
  digits?: number; // decimals shown (default 2)
};

export const ScoreRace: React.FC<ScoreRaceProps> = ({
  from, duration = 90, x = 1040, y = 640, width = 820, max = 1, digits = 2,
  title = "Held-out orders",
  rows = [{ label: "Trained", value: 0.82, tone: "river" }, { label: "Base", value: 0.42, tone: "danger" }],
}) => {
  const f = useLocal(from, duration);
  const pop = usePop(f ?? 0, 0, 13, 220);
  if (f === null) return null;
  const grow = 28; // frames per bar
  const barW = width - 300;
  const best = Math.max(...rows.map((r) => r.value));
  const done = 6 + grow;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: fadeOut(f, duration) }}>
      <div style={{ ...plate, position: "absolute", left: x, top: y, width, padding: "18px 26px 22px", transform: `scale(${pop}) skewX(-4deg)`, transformOrigin: "left top" }}>
        <div style={{ fontFamily: HEAD, fontWeight: 900, fontSize: 30, letterSpacing: "0.16em", textTransform: "uppercase", color: "#d9c79f", marginBottom: 12 }}>{title}</div>
        {rows.map((r, i) => {
          const t = TONE[r.tone ?? "gold"];
          const p = interpolate(f, [6, 6 + grow], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
          const v = r.value * p;
          const lead = r.value === best && f >= done;
          const tagPop = interpolate(f, [done, done + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(3)) });
          return (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 16, height: 70, position: "relative" }}>
              <div style={{ width: 130, fontFamily: HEAD, fontWeight: 800, fontSize: 34, textTransform: "uppercase", color: FX.ink }}>{r.label}</div>
              <div style={{ width: barW, height: 42, borderRadius: 8, background: "rgba(6,8,11,.7)", boxShadow: `inset 0 0 0 2px ${FX.stoneMid}`, position: "relative", overflow: "visible" }}>
                <div
                  style={{
                    width: `${(v / max) * 100}%`, height: "100%", borderRadius: 8,
                    background: `linear-gradient(180deg, ${t.hi}, ${t.main} 45%, ${t.deep})`, boxShadow: `0 0 0 3px ${FX.outline}, 0 0 18px ${t.main}`,
                  }}
                />
                {lead ? (
                  <div
                    style={{
                      position: "absolute", left: `${(r.value / max) * 100}%`, top: -30, transform: `translate(-50%, 0) scale(${tagPop}) rotate(8deg)`,
                      padding: "2px 12px", borderRadius: 6, background: FX.gold, color: FX.outline, fontFamily: HEAD, fontWeight: 900, fontSize: 24,
                      letterSpacing: "0.08em", boxShadow: `0 0 0 3px ${FX.outline}`, whiteSpace: "nowrap",
                    }}
                  >
                    WINNER
                  </div>
                ) : null}
              </div>
              <div style={{ width: 120, textAlign: "right", fontFamily: HEAD, fontWeight: 900, fontSize: 44, color: t.hi, textShadow: `0 3px 0 ${FX.outline}` }}>
                {v.toFixed(digits)}
              </div>
              {lead ? <SparkleBurst f={f - done} x={130 + 16 + barW * (r.value / max)} y={35} count={8} radius={90} life={16} seed={`sr${i}`} /> : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
