// FxGallery: every CUES entry in turn over a mock board backdrop, for review (raid-video-rev).
// Also shows punchTransform on the backdrop. Register in Root with durationInFrames={FX_GALLERY_FRAMES}.
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { FxCue } from "../timeline";
import { CUES, punchTransform } from "./cues";
import { FX, HEAD } from "./theme";

type Demo = { kind: string; text?: string; x?: number; y?: number };
const DEMOS: Demo[] = [
  { kind: "punchIn", x: 1300, y: 420 },
  { kind: "callout", text: "THE LIBRARY|GBrain, shared memory", x: 560, y: 420 },
  { kind: "calloutRecall", text: "RECALL", x: 1400, y: 500 },
  { kind: "calloutRiver", text: "THE FORGE|River AI", x: 700, y: 700 },
  { kind: "pagePop", x: 560, y: 380 },
  { kind: "approvedStamp" },
  { kind: "forgedBurst", text: "Rule Warden" },
  { kind: "scoreRace", text: "0.917 vs 0.557|Held-out review orders", x: 1000, y: 620 },
  { kind: "comboOrders", text: "7 ORDERS" },
  { kind: "comboTokens", text: "12480 TOKENS" },
  { kind: "mascotCheer", text: "VICTORY!" },
  { kind: "mascotShock", text: "A NEW ISSUE?!", x: 1500 },
  { kind: "mascotSmug", text: "TOO EASY" },
  { kind: "mascotThink", text: "RECALLING" },
  { kind: "speedWipe", text: "NEXT: TEAMS" },
];
const GAP = 10;
const starts: number[] = [];
let acc = 0;
for (const d of DEMOS) {
  starts.push(acc);
  acc += CUES[d.kind].frames + GAP;
}
export const FX_GALLERY_FRAMES = acc;

// Stand-in for a capture: dark grass diamond grid with a few camps and the Library.
const Backdrop: React.FC = () => (
  <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 45%, #2e3a22, #141a10 80%)" }}>
    <AbsoluteFill
      style={{
        opacity: 0.35,
        backgroundImage: "linear-gradient(30deg, rgba(200,164,98,.25) 1px, transparent 1px), linear-gradient(150deg, rgba(200,164,98,.25) 1px, transparent 1px)",
        backgroundSize: "120px 70px",
      }}
    />
    {[[560, 420, FX.gold, "Library"], [1300, 420, FX.danger, "Camp"], [700, 700, FX.river, "Forge"], [1400, 500, FX.recall, "Knight"]].map(([x, y, c, n]) => (
      <div key={n as string} style={{ position: "absolute", left: (x as number) - 50, top: (y as number) - 50, width: 100, height: 100, borderRadius: 18, background: c as string, border: `5px solid ${FX.outline}`, transform: "rotate(45deg) scaleY(.6)" }} />
    ))}
  </AbsoluteFill>
);

export const FxGallery: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const punchCues: FxCue[] = DEMOS.map((d, i) => ({ at: starts[i] / fps, kind: d.kind, x: d.x, y: d.y })).filter((c) => c.kind === "punchIn");
  const cur = Math.max(0, starts.filter((s) => s <= frame).length - 1);
  return (
    <AbsoluteFill style={{ background: FX.slate }}>
      <AbsoluteFill style={{ transform: punchTransform(frame, fps, punchCues) }}>
        <Backdrop />
      </AbsoluteFill>
      {DEMOS.map((d, i) => {
        const C = CUES[d.kind].C;
        return (
          <Sequence key={i} from={starts[i]} durationInFrames={CUES[d.kind].frames} layout="none">
            <C text={d.text} x={d.x} y={d.y} />
          </Sequence>
        );
      })}
      <div style={{ position: "absolute", left: 24, top: 18, fontFamily: HEAD, fontWeight: 800, fontSize: 30, color: FX.ink, opacity: 0.8, letterSpacing: "0.08em" }}>
        FX GALLERY {cur + 1}/{DEMOS.length}: {DEMOS[cur].kind}
      </div>
    </AbsoluteFill>
  );
};
