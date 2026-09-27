// 6 s end card in the intro style (raid-video-intro for raid-video). 180 frames, no props, no audio.
// All text has landed by frame 20 and stays still to the end.
import React from "react";
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {C, Defs, Flash, FONT_BODY, FONT_HEAD, Halftone, RadialLines, slam, Sparkles, TitleLine, Vignette} from "./anime";
import {Chibi, Slime} from "./chars";

export const END_CARD_FRAMES = 180;

export const EndCardAnime: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const logo = slam(f, fps, 2, 11);
  const url = slam(f, fps, 10);
  const squad = [
    {kind: "knight" as const, x: 250, face: "fierce" as const},
    {kind: "ranger" as const, x: 510, face: "happy" as const},
    {kind: "forged" as const, x: 1410, face: "fierce" as const},
    {kind: "scout" as const, x: 1670, face: "happy" as const},
  ];
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 42%, #fff3c9 0%, ${C.goldHi} 22%, ${C.gold} 48%, #6a3e10 100%)`}}>
      <RadialLines color="#fff" opacity={0.45} cy={420} spin={0.002} seed="end" />
      <Halftone color="rgba(90,50,10,0.3)" />
      <Sparkles count={30} seed="end-s" size={24} start={4} />
      <AbsoluteFill>
        <svg width={1920} height={1080} style={{overflow: "visible"}}>
          <Defs />
          {[0, 1, 2].map((i) => (
            <Slime key={i} x={880 + i * 80} y={1015 - (i === 1 ? 40 : 0)} scale={0.55} color={[C.danger, "#6cbf4a", C.violet][i]} t={0} rot={(i - 1) * 20} ko />
          ))}
          {squad.map((s, i) => {
            const p = slam(f, fps, 3 + i * 3);
            return (
              <g key={s.kind} transform={`translate(0,${(1 - p) * 420})`}>
                <Chibi kind={s.kind} x={s.x} y={1040} scale={1.0} face={s.face} staffUp={1} flip={s.x > 960} glow={0.8} bob={Math.abs(Math.sin(f * 0.18 + i)) * 12} />
              </g>
            );
          })}
          {logo > 0.01 && (
            <g transform={`translate(960,190) rotate(${(1 - logo) * -8}) scale(${interpolate(logo, [0, 1], [3, 0.56])})`}>
              <rect x={-560 + 12} y={-165 + 12} width={1120} height={330} rx={26} fill={C.line} />
              <rect x={-560} y={-165} width={1120} height={330} rx={26} fill="url(#g-plate)" stroke={C.bronze} strokeWidth={12} />
              <rect x={-535} y={-140} width={1070} height={280} rx={18} fill="none" stroke={C.gold} strokeWidth={4} />
              <g transform="skewX(-8)">
                <text x={0} y={82} textAnchor="middle" fontFamily={FONT_HEAD} fontWeight={900} fontSize={250} fill="url(#g-gold)" stroke={C.line} strokeWidth={14} strokeLinejoin="round" paintOrder="stroke" style={{letterSpacing: 14}}>
                  QM RAID
                </text>
              </g>
            </g>
          )}
          <TitleLine text="Built today by one human and 31 AI agents" at={6} y={430} size={80} />
          {url > 0.01 && (
            <g transform={`translate(960,${540 + (1 - url) * 50}) skewX(-10)`} opacity={Math.min(1, url * 1.5)}>
              <rect x={-470 + 8} y={-46 + 8} width={940} height={92} rx={12} fill={C.line} />
              <rect x={-470} y={-46} width={940} height={92} rx={12} fill={C.stone} stroke={C.goldHi} strokeWidth={5} />
              <text textAnchor="middle" y={19} fontFamily={FONT_BODY} fontWeight={800} fontSize={54} fill={C.ink}>
                github.com/aemrebarut/qm-raid
              </text>
            </g>
          )}
          <TitleLine text={"River AI · GBrain · QM"} at={14} y={690} size={72} fill="blue" />
        </svg>
      </AbsoluteFill>
      <Vignette strength={0.35} />
      <Flash at={0} len={3} />
    </AbsoluteFill>
  );
};
