// QM Raid anime intro (raid-video-intro). 15 s at 30 fps, 1920x1080, code-drawn only.
// Beats and art direction: STORYBOARD.md in this folder.
import React from "react";
import {AbsoluteFill, Easing, interpolate, random, Sequence, useCurrentFrame, useVideoConfig} from "remotion";
import {C, Camera, Defs, Flash, FONT_BODY, FONT_HEAD, Halftone, HLines, RadialLines, slam, Sparkles, Sparks, Star, Title, Vignette} from "./anime";
import {Anvil, BigStar, Burst, Chibi, Forge, Hammer, Library, NameCard, Slime} from "./chars";

export const INTRO_FRAMES = 450;

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;
const SLIMES = [C.danger, "#6cbf4a", C.violet, "#e39a3b"];

const Stage: React.FC<{children: React.ReactNode}> = ({children}) => (
  <AbsoluteFill>
    <svg width={1920} height={1080} style={{overflow: "visible"}}>
      <Defs />
      {children}
    </svg>
  </AbsoluteFill>
);

// 1. The backlog attacks: a horde of issue slimes, a panicked scout.
const SceneHorde: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const zoom = interpolate(f, [0, 84], [0.78, 1.1], {...clamp, easing: Easing.out(Easing.quad)});
  const rows = [
    {n: 8, y: 600, s: 0.45, tags: [] as string[]},
    {n: 6, y: 760, s: 0.7, tags: ["", "Noon reindex slows search", "", "", "CSV import fails", ""]},
    {n: 4, y: 975, s: 1.05, tags: ["Duplicate refunds", "OIDC login loops", "Welcome email x2", "Invoice off by 1 cent"]},
  ];
  const scout = slam(f, fps, 48);
  const huh = slam(f, fps, 56);
  return (
    <AbsoluteFill style={{background: "linear-gradient(180deg, #1a0b18 0%, #3a1224 55%, #5e1c16 100%)"}}>
      <Camera hits={[2, 14, 24, 48]} amp={14}>
        <Halftone color="rgba(255,90,70,0.25)" />
        <HLines color="#ffd9c8" count={46} speed={80} opacity={0.28} seed="h1" />
        <AbsoluteFill style={{transform: `scale(${zoom})`, transformOrigin: "50% 75%"}}>
          <Stage>
            {rows.map((r, ri) =>
              Array.from({length: r.n}).map((_, i) => {
                const span = 1920 / r.n;
                const x = span * (i + 0.5) + (random(`hx-${ri}-${i}`) - 0.5) * span * 0.3;
                const tag = r.tags[i] || undefined;
                return (
                  <Slime
                    key={`${ri}-${i}`}
                    x={x}
                    y={r.y}
                    scale={r.s}
                    color={SLIMES[(i + ri) % SLIMES.length]}
                    t={f * 0.22 + random(`hp-${ri}-${i}`) * 6}
                    tag={tag}
                  />
                );
              }),
            )}
          </Stage>
        </AbsoluteFill>
        <Stage>
          {scout > 0.01 && (
            <g transform={`translate(0,${(1 - scout) * 300})`}>
              <Chibi kind="scout" x={1740} y={1060} scale={0.8} flip face="panic" sweat={((f - 48) % 20) / 20} bob={Math.abs(Math.sin(f * 0.8)) * 6} />
            </g>
          )}
          {huh > 0.01 && (
            <g transform={`translate(1790,720) scale(${huh}) rotate(8)`}>
              <text textAnchor="middle" fontFamily={FONT_HEAD} fontWeight={900} fontSize={96} fill="#fff" stroke={C.line} strokeWidth={10} paintOrder="stroke">
                !?
              </text>
            </g>
          )}
        </Stage>
        <Title lines={[{text: "YOUR ISSUES"}, {text: "ARE MONSTERS!", fill: "red"}]} at={12} y={180} size={150} stagger={12} />
      </Camera>
      <Vignette />
      <Flash at={0} len={3} />
    </AbsoluteFill>
  );
};

// 2. Heroes assemble: impact frame, gold burst, three chibi units with name cards.
const SceneSquad: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const cast = [
    {kind: "knight" as const, name: "ADA", sub: "KNIGHT  gpt-6-astra", x: 480, at: 6, face: "fierce" as const},
    {kind: "ranger" as const, name: "BRAM", sub: "RANGER  gpt-6-sol", x: 960, at: 18, face: "fierce" as const},
    {kind: "scout" as const, name: "CATO", sub: "SCOUT  gpt-6-luna", x: 1440, at: 30, face: "happy" as const},
  ];
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 58%, #fff3c9 0%, ${C.goldHi} 22%, ${C.gold} 48%, #7a4a14 100%)`}}>
      <Camera hits={[0, 12, 24, 36]} amp={16} impacts={[2]}>
        <RadialLines color="#fff" opacity={0.5} cy={620} spin={0.004} seed="r2" />
        <Halftone color="rgba(90,50,10,0.35)" />
        <Sparkles count={26} seed="s2" size={26} />
        <Stage>
          {cast.map((c) => {
            const s = slam(f, fps, c.at, 10);
            if (s <= 0.001) return null;
            const land = Math.max(0, 1 - Math.abs(f - c.at - 6) / 5);
            return (
              <g key={c.name}>
                <g transform={`translate(0,${(1 - s) * -900})`}>
                  <g transform={`translate(${c.x},880) scale(${1 + 0.12 * land},${1 - 0.12 * land}) translate(${-c.x},-880)`}>
                    <Chibi kind={c.kind} x={c.x} y={880} scale={1.55} face={c.face} bob={Math.abs(Math.sin((f - c.at) * 0.25)) * 8} />
                  </g>
                </g>
                <NameCard x={c.x} y={950} name={c.name} sub={c.sub} p={slam(f, fps, c.at + 8)} w={330} />
              </g>
            );
          })}
        </Stage>
        <Title lines={[{text: "YOUR AI AGENTS"}, {text: "ARE UNITS!"}]} at={44} y={170} size={140} stagger={10} />
      </Camera>
      <Vignette strength={0.35} />
      <Flash at={0} len={2} />
    </AbsoluteFill>
  );
};

// 3. The Library: recall beam in, remember orb back, +1 PAGE.
const SceneLibrary: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const up = slam(f, fps, 8, 14);
  const lib = {x: 470, y: 900};
  const from = {x: lib.x + 145, y: lib.y - 330};
  const gem = {x: 1420 - 64 * 1.5, y: 920 - (70 + 60 * Math.min(1, up) + 168) * 1.5};
  const beamP = interpolate(f, [12, 20], [0, 1], clamp);
  const beamO = interpolate(f, [40, 47], [1, 0], clamp);
  const orbT = interpolate(f, [46, 64], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const ctrl = {x: (gem.x + from.x) / 2, y: 180};
  const bez = (t: number) => ({
    x: (1 - t) * (1 - t) * gem.x + 2 * (1 - t) * t * ctrl.x + t * t * from.x,
    y: (1 - t) * (1 - t) * gem.y + 2 * (1 - t) * t * ctrl.y + t * t * from.y,
  });
  const orb = bez(orbT);
  const pulse = Math.max(0, 1 - Math.abs(f - 66) / 8);
  const page = slam(f, fps, 64);
  const ex = from.x + (gem.x - from.x) * beamP;
  const ey = from.y + (gem.y - from.y) * beamP;
  const glyphs = Array.from({length: 10}).map((_, i) => {
    const t = ((f * 0.05 + i / 10) % 1);
    if (t > beamP) return null;
    const gx = from.x + (gem.x - from.x) * t;
    const gy = from.y + (gem.y - from.y) * t - Math.sin(t * Math.PI * 3 + i) * 26;
    return <Star key={i} x={gx} y={gy} s={12 + (i % 3) * 5} color="#dff0ff" rot={f * 6} opacity={beamO} />;
  });
  return (
    <AbsoluteFill style={{background: "linear-gradient(180deg, #0a1330 0%, #1a2d5c 62%, #22386a 100%)"}}>
      <Camera hits={[64]} amp={10}>
        <Halftone color="rgba(150,190,255,0.18)" />
        <Sparkles count={30} seed="s3" size={12} box={[0, 0, 1920, 560]} color="#cfe3ff" />
        <Stage>
          <ellipse cx={960} cy={1000} rx={1200} ry={150} fill="#101b38" />
          <Library x={lib.x} y={lib.y} scale={1} glow={Math.max(beamP * beamO, pulse)} pulse={pulse} />
          <Chibi kind="knight" x={1420} y={920} scale={1.5} flip staffUp={Math.min(1, up)} face="fierce" bob={Math.abs(Math.sin(f * 0.2)) * 5} />
          {beamP > 0 && (
            <g opacity={beamO}>
              <line x1={from.x} y1={from.y} x2={ex} y2={ey} stroke={C.recall} strokeWidth={70} strokeLinecap="round" opacity={0.45} filter="url(#f-blur)" />
              <line x1={from.x} y1={from.y} x2={ex} y2={ey} stroke={C.recall} strokeWidth={30 + 6 * Math.sin(f)} strokeLinecap="round" />
              <line x1={from.x} y1={from.y} x2={ex} y2={ey} stroke="#f2f9ff" strokeWidth={10} strokeLinecap="round" />
              {glyphs}
            </g>
          )}
          {orbT > 0 && orbT < 1 && (
            <g>
              {[0.08, 0.16, 0.24].map((d) => {
                const p = bez(Math.max(0, orbT - d));
                return <circle key={d} cx={p.x} cy={p.y} r={26 * (1 - d * 2.5)} fill={C.remember} opacity={0.5 - d} />;
              })}
              <circle cx={orb.x} cy={orb.y} r={70} fill={C.remember} opacity={0.5} filter="url(#f-blur)" />
              <circle cx={orb.x} cy={orb.y} r={34} fill="url(#g-orb)" stroke={C.line} strokeWidth={5} />
            </g>
          )}
          <Tag x={(from.x + gem.x) / 2} y={(from.y + gem.y) / 2 + 80} text="RECALL" color={C.recall} p={slam(f, fps, 16)} fade={beamO} />
          <Tag x={ctrl.x} y={300} text="REMEMBER" color={C.remember} p={slam(f, fps, 48)} fade={interpolate(f, [70, 78], [1, 0], clamp)} />
          {page > 0.01 && (
            <g transform={`translate(${lib.x + 380},${lib.y - 520 - page * 30}) scale(${page}) rotate(-6)`}>
              <Burst x={0} y={-6} r={120} color={C.goldHi} points={12} rot={f * 2} />
              <text textAnchor="middle" y={22} fontFamily={FONT_HEAD} fontWeight={900} fontSize={64} fill={C.line}>
                +1 PAGE
              </text>
            </g>
          )}
        </Stage>
        <Title lines={[{text: "GBRAIN IS THEIR"}, {text: "SHARED MEMORY", fill: "blue"}]} at={2} x={1100} y={150} size={120} stagger={10} />
      </Camera>
      <Vignette />
      <Flash at={0} len={2} color={C.recall} peak={0.8} />
    </AbsoluteFill>
  );
};

const Tag: React.FC<{x: number; y: number; text: string; color: string; p: number; fade?: number}> = ({x, y, text, color, p, fade = 1}) => {
  if (p <= 0.01 || fade <= 0) return null;
  const w = text.length * 26 + 50;
  return (
    <g transform={`translate(${x},${y}) scale(${p}) skewX(-10)`} opacity={fade}>
      <rect x={-w / 2} y={-34} width={w} height={64} rx={10} fill={C.line} />
      <rect x={-w / 2} y={-34} width={w} height={64} rx={10} fill="none" stroke={color} strokeWidth={5} />
      <text textAnchor="middle" y={14} fontFamily={FONT_HEAD} fontWeight={900} fontSize={44} fill={color} style={{letterSpacing: 3}}>
        {text}
      </text>
    </g>
  );
};

// 4. The Forge: three hammer strikes, a River-forged unit appears.
const SceneForge: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const hits = [12, 27, 42];
  const angle = interpolate(
    f,
    [0, 9, 12, 14, 22, 27, 29, 37, 42, 46, 60],
    [70, 80, 0, 12, 80, 0, 12, 85, 0, 10, 95],
    clamp,
  );
  const anvilTop = {x: 1200, y: 940 - 74 * 1.3};
  const born = slam(f, fps, 50, 10);
  const pillar = interpolate(f, [44, 50, 62, 72], [0, 1, 1, 0], clamp);
  const heat = Math.max(0.4, ...hits.map((h) => Math.max(0, 1 - Math.abs(f - h) / 6)));
  return (
    <AbsoluteFill style={{background: "radial-gradient(circle at 40% 72%, #3d2614 0%, #1c110b 60%, #0f0906 100%)"}}>
      <Camera hits={hits.concat([50])} amp={16}>
        <Halftone color="rgba(79,167,224,0.2)" />
        <Stage>
          <ellipse cx={960} cy={1000} rx={1200} ry={150} fill="#130c08" />
          <Forge x={540} y={930} scale={1.05} frame={f} heat={heat} />
          <Anvil x={anvilTop.x} y={940} scale={1.3} />
          <Hammer x={1500} y={anvilTop.y - 60} angle={angle} scale={1} />
          {hits.map((h, i) => (
            <Sparks key={h} at={h} x={anvilTop.x - 20} y={anvilTop.y - 6} seed={`sp4-${i}`} count={34} power={1.1} />
          ))}
          {hits.map((h) =>
            f >= h && f < h + 6 ? <Burst key={`b${h}`} x={anvilTop.x - 20} y={anvilTop.y - 10} r={90 + (f - h) * 30} color="#fff" points={10} rot={h} opacity={1 - (f - h) / 6} /> : null,
          )}
          {pillar > 0 && (
            <g opacity={pillar}>
              <rect x={890} y={0} width={180} height={960} fill={C.river} opacity={0.5} filter="url(#f-blur)" />
              <rect x={940} y={0} width={80} height={960} fill="#e8f7ff" opacity={0.85} />
            </g>
          )}
          {born > 0.01 && (
            <g transform={`translate(980,960) scale(${born}) translate(-980,-960)`}>
              <Chibi kind="forged" x={980} y={960} scale={1.45} face="fierce" staffUp={1} glow={0.6 + 0.4 * Math.sin(f * 0.4)} bob={Math.abs(Math.sin(f * 0.25)) * 6} />
            </g>
          )}
          <NameCard x={980} y={660 - 540} name="REFUND RANGER" sub="NEW UNIT TYPE, TRAINED WITH RIVER" accent="#8fd0ff" p={slam(f, fps, 60)} w={560} />
        </Stage>
        <Title lines={[{text: "RIVER FORGES", fill: "blue"}, {text: "NEW UNIT TYPES!"}]} at={2} x={1180} y={170} size={120} stagger={10} />
      </Camera>
      <Vignette />
      {hits.map((h) => (
        <Flash key={h} at={h} len={2} peak={0.75} />
      ))}
    </AbsoluteFill>
  );
};

// 5. Charge, clash, logo slam, speed-line wipe to white.
const SceneFinale: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const CLASH = 15;
  const pre = f < CLASH + 2;
  const run = interpolate(f, [0, CLASH], [0, 1], {...clamp, easing: Easing.in(Easing.quad)});
  const zoom = pre ? interpolate(f, [0, CLASH], [1, 1.35], clamp) : 1;
  const logo = slam(f, fps, 18, 10);
  const sub = slam(f, fps, 30);
  const squad = [
    {kind: "knight" as const, x: 330},
    {kind: "ranger" as const, x: 590},
    {kind: "forged" as const, x: 1330},
    {kind: "scout" as const, x: 1590},
  ];
  return (
    <AbsoluteFill style={{background: pre ? "linear-gradient(180deg, #2a241c, #14100c)" : `radial-gradient(circle at 50% 40%, #fff3c9 0%, ${C.goldHi} 20%, ${C.gold} 45%, #6a3e10 100%)`}}>
      <Camera hits={[CLASH, CLASH + 3, 18]} amp={24} impacts={[CLASH + 2]}>
        {pre ? (
          <>
            <HLines color={C.goldHi} count={60} speed={140} opacity={0.5} seed="h5" dir={1} />
            <AbsoluteFill style={{transform: `scale(${zoom})`, transformOrigin: "50% 70%"}}>
              <Stage>
                {squad.map((s, i) => (
                  <Chibi key={s.kind} kind={s.kind} x={-300 + i * 150 + run * 900} y={900 + (i % 2) * 60} scale={1.2} face="fierce" run={f * 0.9 + i} lean={10} bob={Math.abs(Math.sin(f * 0.9 + i)) * 14} staffUp={0.3} />
                ))}
                {[0, 1, 2].map((i) => (
                  <Slime key={i} x={2250 + i * 180 - run * 900} y={900 + i * 50} scale={1.1} color={SLIMES[i]} t={f * 0.5 + i} />
                ))}
              </Stage>
            </AbsoluteFill>
          </>
        ) : (
          <>
            <RadialLines color="#fff" opacity={0.55} cy={420} spin={0.003} seed="r5" />
            <Halftone color="rgba(90,50,10,0.3)" />
            <Sparkles count={34} seed="s5" size={28} start={18} />
            <Stage>
              {[0, 1, 2].map((i) => {
                const t = f - CLASH;
                return (
                  <g key={i} opacity={interpolate(t, [20, 30], [1, 0], clamp)}>
                    <Slime x={1100 + t * (30 + i * 12)} y={760 - t * (26 - i * 6) + t * t * 0.5} scale={0.9} color={SLIMES[i]} t={0} rot={t * 25} ko />
                  </g>
                );
              })}
              {squad.map((s, i) => {
                const p = slam(f, fps, CLASH + 4 + i * 3);
                return (
                  <g key={s.kind} transform={`translate(0,${(1 - p) * 400})`}>
                    <Chibi kind={s.kind} x={s.x} y={1050} scale={1.05} face={i % 2 ? "happy" : "fierce"} staffUp={1} flip={s.x > 960} glow={0.8} bob={Math.abs(Math.sin(f * 0.35 + i)) * 16} />
                  </g>
                );
              })}
              {logo > 0.01 && (
                <g transform={`translate(960,410) rotate(${(1 - logo) * -8}) scale(${interpolate(logo, [0, 1], [3, 1])})`}>
                  <rect x={-560 + 12} y={-165 + 12} width={1120} height={330} rx={26} fill={C.line} />
                  <rect x={-560} y={-165} width={1120} height={330} rx={26} fill="url(#g-plate)" stroke={C.bronze} strokeWidth={12} />
                  <rect x={-535} y={-140} width={1070} height={280} rx={18} fill="none" stroke={C.gold} strokeWidth={4} />
                  {[
                    [-520, -125],
                    [520, -125],
                    [-520, 125],
                    [520, 125],
                  ].map(([rx, ry]) => (
                    <circle key={`${rx},${ry}`} cx={rx} cy={ry} r={11} fill={C.bronzeHi} stroke={C.line} strokeWidth={4} />
                  ))}
                  <g transform="skewX(-8)">
                    <text x={10} y={92} textAnchor="middle" fontFamily={FONT_HEAD} fontWeight={900} fontSize={250} fill={C.line} stroke={C.line} strokeWidth={24} strokeLinejoin="round" style={{letterSpacing: 14}}>
                      QM RAID
                    </text>
                    <text x={0} y={82} textAnchor="middle" fontFamily={FONT_HEAD} fontWeight={900} fontSize={250} fill="url(#g-gold)" stroke={C.line} strokeWidth={14} strokeLinejoin="round" paintOrder="stroke" style={{letterSpacing: 14}}>
                      QM RAID
                    </text>
                  </g>
                  <BigStar x={-540} y={-150} s={60 * Math.max(0, Math.sin((f - 18) * 0.2))} />
                  <BigStar x={540} y={150} s={60 * Math.max(0, Math.sin((f - 24) * 0.2))} />
                </g>
              )}
              {sub > 0.01 && (
                <g transform={`translate(960,${650 + (1 - sub) * 60}) skewX(-10)`} opacity={Math.min(1, sub * 1.4)}>
                  <rect x={-560 + 8} y={-44 + 8} width={1120} height={88} rx={10} fill={C.line} />
                  <rect x={-560} y={-44} width={1120} height={88} rx={10} fill="#8a2a22" stroke={C.goldHi} strokeWidth={5} />
                  <text textAnchor="middle" y={17} fontFamily={FONT_BODY} fontWeight={800} fontSize={46} fill={C.ink} style={{letterSpacing: 3}}>
                    AN RTS BOARD FOR YOUR AI AGENT SWARM
                  </text>
                </g>
              )}
            </Stage>
          </>
        )}
      </Camera>
      <Vignette strength={0.35} />
      <Flash at={CLASH} len={2} />
      <Wipe start={78} />
    </AbsoluteFill>
  );
};

// Speed-line wipe to white over the last frames, for the editor's cut.
const Wipe: React.FC<{start: number}> = ({start}) => {
  const f = useCurrentFrame();
  if (f < start) return null;
  const bars = 36;
  const h = 1080 / bars;
  return (
    <AbsoluteFill>
      <svg width={1920} height={1080}>
        {Array.from({length: bars}).map((_, i) => {
          const d = random(`w-${i}`) * 4;
          const w = interpolate(f, [start + d, start + d + 7], [0, 2300], {...clamp, easing: Easing.in(Easing.quad)});
          return <rect key={i} x={0} y={i * h - 1} width={w} height={h + 2} fill="#fff" />;
        })}
      </svg>
    </AbsoluteFill>
  );
};

export const Intro: React.FC = () => (
  <AbsoluteFill style={{background: "#000"}}>
    <Sequence from={0} durationInFrames={84} name="1 Horde">
      <SceneHorde />
    </Sequence>
    <Sequence from={84} durationInFrames={96} name="2 Squad">
      <SceneSquad />
    </Sequence>
    <Sequence from={180} durationInFrames={90} name="3 Library">
      <SceneLibrary />
    </Sequence>
    <Sequence from={270} durationInFrames={90} name="4 Forge">
      <SceneForge />
    </Sequence>
    <Sequence from={360} durationInFrames={90} name="5 Finale">
      <SceneFinale />
    </Sequence>
  </AbsoluteFill>
);
