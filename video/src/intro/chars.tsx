// Chibi cast for the intro, drawn as SVG groups with origin at the feet (0, 0).
// Knight, ranger, scout, a River-forged unit, slime monsters, the Library and the Forge.
import React from "react";
import {C, FONT_BODY, FONT_HEAD, starPath} from "./anime";

const L = C.line;
const SW = 6;
const SKIN = "#f6d2ae";

export type Kind = "knight" | "ranger" | "scout" | "forged";
export type Face = "normal" | "fierce" | "panic" | "happy";

export const Chibi: React.FC<{
  kind: Kind;
  x: number;
  y: number;
  scale?: number;
  team?: string;
  flip?: boolean;
  staffUp?: number;
  bob?: number;
  face?: Face;
  sweat?: number;
  run?: number;
  lean?: number;
  glow?: number;
}> = ({kind, x, y, scale = 1, team = C.red, flip = false, staffUp = 0, bob = 0, face = "normal", sweat = -1, run, lean = 0, glow = 0}) => {
  const forged = kind === "forged";
  const tabard = forged ? "#2f7fb8" : team;
  const handY = -70 - 60 * staffUp;
  const legA = run === undefined ? 0 : Math.sin(run) * 28;
  const stroke = {stroke: L, strokeWidth: SW, strokeLinejoin: "round" as const, strokeLinecap: "round" as const};
  return (
    <g transform={`translate(${x},${y}) scale(${flip ? -scale : scale},${scale})`}>
      <ellipse cx={0} cy={0} rx={66} ry={13} fill="rgba(0,0,0,0.35)" />
      <g transform={`translate(0,${-bob}) rotate(${lean})`}>
        {forged && glow > 0 && <ellipse cx={0} cy={-130} rx={120} ry={150} fill={C.river} opacity={0.35 * glow} filter="url(#f-blur)" />}
        {/* hood back and cape */}
        {(kind === "ranger" || forged) && (
          <g {...stroke}>
            <path d="M-50,-122 Q-80,-60 -62,-26 L62,-26 Q80,-60 50,-122 Z" fill={forged ? "#1f5a86" : "#2f5a2c"} />
            <circle cx={0} cy={-180} r={76} fill={forged ? "#2a6c9e" : "#3d6b3a"} />
            <path d="M40,-238 L118,-262 L70,-192 Z" fill={forged ? "#2a6c9e" : "#3d6b3a"} />
          </g>
        )}
        {kind === "scout" && (
          <path d="M-48,-120 Q-84,-64 -70,-30 L20,-34 Q-10,-80 40,-122 Z" fill="#c9a66b" {...stroke} />
        )}
        {/* legs */}
        <g {...stroke}>
          <g transform={`rotate(${legA},-18,-44)`}>
            <rect x={-32} y={-46} width={26} height={44} rx={9} fill="#4a3727" />
            <rect x={-38} y={-18} width={34} height={18} rx={8} fill="#2d1f14" />
          </g>
          <g transform={`rotate(${-legA},18,-44)`}>
            <rect x={6} y={-46} width={26} height={44} rx={9} fill="#4a3727" />
            <rect x={4} y={-18} width={34} height={18} rx={8} fill="#2d1f14" />
          </g>
        </g>
        {/* body */}
        <g {...stroke}>
          <path d="M-48,-120 Q-54,-72 -50,-36 Q0,-26 50,-36 Q54,-72 48,-120 Q0,-130 -48,-120 Z" fill={tabard} />
        </g>
        <path d="M10,-126 Q40,-124 47,-118 Q53,-72 49,-38 Q30,-32 10,-31 Z" fill="rgba(0,0,0,0.18)" />
        <rect x={-50} y={-66} width={100} height={13} fill="#5a3a1e" stroke={L} strokeWidth={4} />
        <rect x={-9} y={-68} width={18} height={17} rx={3} fill={C.goldHi} stroke={L} strokeWidth={3} />
        {kind === "knight" && <path d="M-22,-112 L0,-88 L22,-112" fill="none" stroke={C.goldHi} strokeWidth={9} strokeLinecap="round" />}
        {forged && (
          <g stroke="#bfefff" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.6 + 0.4 * glow} filter="url(#f-glow)">
            <path d="M-26,-110 L-14,-92 L-26,-78" />
            <path d="M0,-112 L0,-80" />
            <path d="M26,-110 L14,-92 L26,-78" />
          </g>
        )}
        {kind === "ranger" && <path d="M-40,-118 L40,-44" stroke="#6b4a2a" strokeWidth={9} />}
        {/* left arm */}
        <ellipse cx={-56} cy={-86} rx={15} ry={25} fill={tabard} {...stroke} />
        <circle cx={-58} cy={-60} r={12} fill={SKIN} {...stroke} />
        {/* weapon in right hand */}
        {(kind === "knight" || forged) && (
          <g>
            <line x1={64} y1={handY + 56} x2={64} y2={handY - 150} stroke={L} strokeWidth={17} strokeLinecap="round" />
            <line x1={64} y1={handY + 56} x2={64} y2={handY - 150} stroke="#8a5a2e" strokeWidth={8} strokeLinecap="round" />
            {staffUp > 0.3 && <circle cx={64} cy={handY - 168} r={34 * staffUp} fill={C.recall} opacity={0.45} filter="url(#f-blur)" />}
            <circle cx={64} cy={handY - 168} r={17} fill={forged ? "#bfefff" : C.recall} {...stroke} strokeWidth={5} />
            <circle cx={58} cy={handY - 174} r={5} fill="#fff" />
          </g>
        )}
        {kind === "ranger" && (
          <g fill="none" strokeLinecap="round">
            <path d={`M66,${handY - 120} Q126,${handY - 20} 66,${handY + 80}`} stroke={L} strokeWidth={16} />
            <path d={`M66,${handY - 120} Q126,${handY - 20} 66,${handY + 80}`} stroke="#8a5a2e" strokeWidth={8} />
            <line x1={66} y1={handY - 120} x2={66} y2={handY + 80} stroke="#f2ead8" strokeWidth={3} />
          </g>
        )}
        <ellipse cx={56} cy={handY - 14} rx={15} ry={24} fill={tabard} {...stroke} transform={`rotate(${-20 * staffUp},56,${handY - 14})`} />
        <circle cx={62} cy={handY + 6} r={12} fill={SKIN} {...stroke} />
        {/* head */}
        {kind === "scout" && (
          <path d="M-66,-186 L-58,-238 L-30,-226 L-10,-262 L14,-230 L42,-252 L48,-218 L70,-200 Q70,-250 0,-252 Q-70,-248 -66,-186 Z" fill="#7a4a24" {...stroke} />
        )}
        <circle cx={0} cy={-178} r={64} fill={SKIN} {...stroke} />
        <FaceParts face={face} big={kind === "scout"} />
        {/* headgear */}
        {kind === "knight" && (
          <g {...stroke}>
            <path d="M0,-240 C22,-300 76,-304 98,-270 C64,-276 36,-262 18,-236 Z" fill={team} />
            <path d="M-70,-184 C-70,-266 70,-266 70,-184 L70,-174 Q0,-198 -70,-174 Z" fill="#c3cad3" />
            <path d="M8,-248 C48,-244 66,-214 70,-184 L70,-174 Q44,-184 30,-186 C34,-214 26,-236 8,-248 Z" fill="rgba(0,0,0,0.15)" stroke="none" />
            <rect x={-6} y={-196} width={12} height={30} rx={4} fill="#aab2bc" />
          </g>
        )}
        {(kind === "ranger" || forged) && (
          <path d="M-70,-172 C-70,-250 70,-250 70,-172 Q60,-214 0,-216 Q-60,-214 -70,-172 Z" fill={forged ? "#2a6c9e" : "#3d6b3a"} {...stroke} />
        )}
        {forged && (
          <path d="M-30,-232 L-10,-222 L10,-232 L30,-222" fill="none" stroke="#bfefff" strokeWidth={5} strokeLinecap="round" filter="url(#f-glow)" />
        )}
        {kind === "scout" && (
          <g {...stroke}>
            <rect x={-66} y={-214} width={132} height={16} rx={6} fill={team} />
            <path d="M62,-210 Q96,-214 112,-196 Q92,-200 70,-198 Z" fill={team} />
            <path d="M62,-204 Q92,-190 100,-170 Q84,-186 64,-196 Z" fill={team} />
          </g>
        )}
        {/* shield */}
        {kind === "knight" && (
          <g {...stroke}>
            <path d="M-104,-126 L-30,-126 L-30,-84 Q-30,-46 -67,-28 Q-104,-46 -104,-84 Z" fill={team} />
            <path d="M-67,-124 L-67,-32 M-102,-92 L-32,-92" stroke={C.goldHi} strokeWidth={8} />
          </g>
        )}
        {sweat >= 0 && (
          <path
            d="M0,-20 Q16,4 0,12 Q-16,4 0,-20 Z"
            transform={`translate(74,${-236 + sweat * 40})`}
            fill="#a8dcff"
            stroke={L}
            strokeWidth={4}
          />
        )}
      </g>
    </g>
  );
};

const FaceParts: React.FC<{face: Face; big: boolean}> = ({face, big}) => {
  const ry = big ? 17 : 14;
  const blush = <>
    <ellipse cx={-42} cy={-150} rx={11} ry={6} fill="#f29a8a" opacity={0.75} />
    <ellipse cx={42} cy={-150} rx={11} ry={6} fill="#f29a8a" opacity={0.75} />
  </>;
  if (face === "panic") {
    return (
      <g>
        <circle cx={-24} cy={-172} r={17} fill="#fff" stroke={L} strokeWidth={5} />
        <circle cx={24} cy={-172} r={17} fill="#fff" stroke={L} strokeWidth={5} />
        <circle cx={-22} cy={-170} r={5} fill={L} />
        <circle cx={22} cy={-170} r={5} fill={L} />
        {blush}
        <path d="M-16,-140 q4,-7 8,0 q4,7 8,0 q4,-7 8,0" fill="none" stroke={L} strokeWidth={5} strokeLinecap="round" />
      </g>
    );
  }
  if (face === "happy") {
    return (
      <g fill="none" stroke={L} strokeWidth={7} strokeLinecap="round">
        <path d="M-36,-168 Q-24,-184 -12,-168" />
        <path d="M12,-168 Q24,-184 36,-168" />
        {blush}
        <path d="M-14,-148 Q0,-128 14,-148 Z" fill="#8a2a1a" strokeWidth={5} />
      </g>
    );
  }
  const fierce = face === "fierce";
  return (
    <g>
      <ellipse cx={-24} cy={-168} rx={10} ry={fierce ? ry - 3 : ry} fill={L} />
      <ellipse cx={24} cy={-168} rx={10} ry={fierce ? ry - 3 : ry} fill={L} />
      <circle cx={-20} cy={-174} r={4.5} fill="#fff" />
      <circle cx={28} cy={-174} r={4.5} fill="#fff" />
      {fierce && (
        <g stroke={L} strokeWidth={7} strokeLinecap="round">
          <line x1={-42} y1={-196} x2={-10} y2={-186} />
          <line x1={42} y1={-196} x2={10} y2={-186} />
        </g>
      )}
      {blush}
      {fierce ? (
        <path d="M-14,-148 Q0,-128 14,-148 Z" fill="#8a2a1a" stroke={L} strokeWidth={5} strokeLinejoin="round" />
      ) : (
        <path d="M-9,-146 Q0,-138 9,-146" fill="none" stroke={L} strokeWidth={5} strokeLinecap="round" />
      )}
    </g>
  );
};

// Bouncing slime monster with angry eyes and an optional issue tag.
export const Slime: React.FC<{
  x: number;
  y: number;
  scale?: number;
  color: string;
  t: number;
  tag?: string;
  rot?: number;
  ko?: boolean;
}> = ({x, y, scale = 1, color, t, tag, rot = 0, ko = false}) => {
  const hop = Math.abs(Math.sin(t));
  const ground = Math.pow(1 - hop, 6);
  const sx = 1 + 0.22 * ground - 0.06 * hop;
  const sy = 1 - 0.22 * ground + 0.1 * hop;
  const lift = -hop * 70;
  const stroke = {stroke: L, strokeWidth: 7, strokeLinejoin: "round" as const, strokeLinecap: "round" as const};
  const tagW = tag ? tag.length * 13.5 + 40 : 0;
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <ellipse cx={0} cy={4} rx={90 * (1 - hop * 0.4)} ry={16} fill="rgba(0,0,0,0.35)" />
      <g transform={`translate(0,${lift}) rotate(${rot},0,-75) scale(${sx},${sy})`}>
        <path d="M-96,0 C-102,-72 -62,-152 0,-152 C62,-152 102,-72 96,0 Q0,14 -96,0 Z" fill={color} {...stroke} />
        <path d="M30,-146 C74,-128 100,-70 96,0 Q60,8 30,10 C70,-40 64,-110 30,-146 Z" fill="rgba(0,0,0,0.2)" />
        <ellipse cx={-44} cy={-112} rx={20} ry={11} fill="#fff" opacity={0.65} transform="rotate(-35,-44,-112)" />
        {ko ? (
          <g stroke={L} strokeWidth={8} strokeLinecap="round">
            <path d="M-46,-94 L-20,-68 M-20,-94 L-46,-68" />
            <path d="M20,-94 L46,-68 M46,-94 L20,-68" />
          </g>
        ) : (
          <g>
            <ellipse cx={-32} cy={-80} rx={19} ry={21} fill="#fff" stroke={L} strokeWidth={5} />
            <ellipse cx={32} cy={-80} rx={19} ry={21} fill="#fff" stroke={L} strokeWidth={5} />
            <circle cx={-26} cy={-74} r={8} fill={L} />
            <circle cx={26} cy={-74} r={8} fill={L} />
            <path d="M-60,-112 L-14,-94 M60,-112 L14,-94" stroke={L} strokeWidth={11} strokeLinecap="round" />
          </g>
        )}
        <path d="M-38,-42 Q0,-22 38,-42 Q0,-2 -38,-42 Z" fill="#3a0d0d" {...stroke} strokeWidth={5} />
        <path d="M-24,-36 l7,10 l7,-8 Z M10,-34 l7,8 l7,-10 Z" fill="#fff" />
      </g>
      {tag && (
        <g transform={`translate(0,${lift - 196})`}>
          <line x1={0} y1={20} x2={0} y2={44} stroke={L} strokeWidth={5} />
          <rect x={-tagW / 2} y={-26} width={tagW} height={48} rx={8} fill={C.ink} stroke={L} strokeWidth={5} />
          <text x={0} y={9} textAnchor="middle" fontFamily={FONT_BODY} fontWeight={800} fontSize={25} fill={L}>
            {tag}
          </text>
        </g>
      )}
    </g>
  );
};

// The Library (GBrain): stone hall, blue slate roofs, glowing windows, book crest.
export const Library: React.FC<{x: number; y: number; scale?: number; glow?: number; pulse?: number}> = ({x, y, scale = 1, glow = 0.5, pulse = 0}) => {
  const stroke = {stroke: L, strokeWidth: SW, strokeLinejoin: "round" as const};
  const sc = scale * (1 + 0.06 * pulse);
  return (
    <g transform={`translate(${x},${y}) scale(${sc})`}>
      <ellipse cx={0} cy={4} rx={290} ry={30} fill="rgba(0,0,0,0.35)" />
      <circle cx={-80} cy={-120} r={150 + 60 * pulse} fill={C.recall} opacity={0.18 + 0.35 * glow} filter="url(#f-blur)" />
      <circle cx={145} cy={-330} r={80 + 40 * pulse} fill={C.recall} opacity={0.15 + 0.35 * glow} filter="url(#f-blur)" />
      <g {...stroke}>
        <rect x={-235} y={-262} width={310} height={262} fill="#a39d93" />
        <rect x={70} y={-420} width={150} height={420} fill="#958f86" />
        <path d="M-262,-258 L-80,-372 L100,-258 Z" fill="#3b5a8c" />
        <path d="M48,-416 L145,-566 L242,-416 Z" fill="#34507e" />
      </g>
      <path d="M-80,-372 L100,-258 L40,-258 Z" fill="rgba(0,0,0,0.18)" />
      <path d="M145,-566 L242,-416 L190,-416 Z" fill="rgba(0,0,0,0.18)" />
      <g stroke="rgba(36,23,13,0.35)" strokeWidth={3}>
        {[-230, -198, -166, -134, -102, -70, -38].map((yy) => (
          <line key={yy} x1={-232} y1={yy} x2={72} y2={yy} />
        ))}
        {[-390, -350, -310, -270, -230, -190, -150, -110, -70, -30].map((yy) => (
          <line key={yy} x1={72} y1={yy} x2={218} y2={yy} />
        ))}
      </g>
      <path d="M-160,-36 L-160,-168 Q-80,-256 0,-168 L0,-36 Z" fill="url(#g-window)" {...stroke} />
      <path d="M-80,-36 L-80,-212 M-160,-110 L0,-110" stroke={L} strokeWidth={5} />
      <path d="M118,-290 L118,-350 Q145,-386 172,-350 L172,-290 Z" fill="url(#g-window)" {...stroke} />
      <path d="M110,0 L110,-84 Q145,-124 180,-84 L180,0 Z" fill="#5a3a1e" {...stroke} />
      <g transform="translate(145,-200)">
        <rect x={-40} y={-36} width={80} height={76} rx={8} fill={C.gold} {...stroke} strokeWidth={5} />
        <path d="M-26,-14 Q-13,-24 0,-14 Q13,-24 26,-14 L26,18 Q13,8 0,18 Q-13,8 -26,18 Z" fill={C.ink} stroke={L} strokeWidth={4} strokeLinejoin="round" />
        <path d="M0,-14 L0,18" stroke={L} strokeWidth={3} />
      </g>
      <g transform="translate(-80,56)">
        <rect x={-190} y={-30} width={380} height={60} rx={10} fill="url(#g-plate)" stroke={C.gold} strokeWidth={5} />
        <text x={0} y={16} textAnchor="middle" fontFamily={FONT_HEAD} fontWeight={900} fontSize={40} fill={C.goldHi} style={{letterSpacing: 4}}>
          GBRAIN LIBRARY
        </text>
      </g>
    </g>
  );
};

// The Forge (River): timber smithy, stone chimney, River-blue furnace, smoke.
export const Forge: React.FC<{x: number; y: number; scale?: number; frame: number; heat?: number}> = ({x, y, scale = 1, frame, heat = 0.5}) => {
  const stroke = {stroke: L, strokeWidth: SW, strokeLinejoin: "round" as const};
  const flick = 0.8 + 0.2 * Math.sin(frame * 0.9) * Math.sin(frame * 0.37);
  const puffs = [0, 1, 2, 3, 4].map((i) => {
    const t = ((frame + i * 14) % 70) / 70;
    return <circle key={i} cx={185 + Math.sin(t * 6 + i) * 20 + t * 40} cy={-430 - t * 260} r={24 + t * 50} fill="#7a7068" opacity={0.55 * (1 - t)} stroke={L} strokeWidth={4 * (1 - t)} />;
  });
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <ellipse cx={0} cy={4} rx={300} ry={30} fill="rgba(0,0,0,0.35)" />
      {puffs}
      <circle cx={185} cy={-70} r={170} fill={C.river} opacity={(0.3 + 0.4 * heat) * flick} filter="url(#f-blur)" />
      <g {...stroke}>
        <rect x={-250} y={-236} width={390} height={236} fill="#e0cba5" />
        <path d="M-282,-232 L-55,-370 L172,-232 Z" fill="#7a4326" />
        <rect x={148} y={-430} width={76} height={430} fill="#77716a" />
      </g>
      <path d="M-55,-370 L172,-232 L110,-232 Z" fill="rgba(0,0,0,0.2)" />
      <g stroke="#5a3418" strokeWidth={14} strokeLinecap="square">
        <line x1={-244} y1={-120} x2={134} y2={-120} />
        <line x1={-160} y1={-230} x2={-160} y2={-4} />
        <line x1={-40} y1={-230} x2={-40} y2={-4} />
        <line x1={70} y1={-230} x2={70} y2={-4} />
        <line x1={-160} y1={-230} x2={-40} y2={-124} />
      </g>
      <rect x={-250} y={-236} width={390} height={236} fill="none" stroke={L} strokeWidth={SW} />
      <path d="M156,0 L156,-100 Q186,-146 216,-100 L216,0 Z" fill="url(#g-river)" stroke={L} strokeWidth={SW} opacity={flick} />
      <path d="M-120,0 L-120,-80 Q-90,-110 -60,-80 L-60,0 Z" fill="#4a2a14" {...stroke} />
      <g transform="translate(-100,-300)">
        <rect x={-70} y={-26} width={140} height={52} rx={8} fill="#1d5f96" stroke={L} strokeWidth={5} />
        <text x={0} y={14} textAnchor="middle" fontFamily={FONT_HEAD} fontWeight={900} fontSize={36} fill="#e8f5ff" style={{letterSpacing: 4}}>
          RIVER
        </text>
      </g>
      <g transform="translate(-55,56)">
        <rect x={-110} y={-30} width={220} height={60} rx={10} fill="url(#g-plate)" stroke={C.river} strokeWidth={5} />
        <text x={0} y={16} textAnchor="middle" fontFamily={FONT_HEAD} fontWeight={900} fontSize={40} fill="#bfe6ff" style={{letterSpacing: 4}}>
          THE FORGE
        </text>
      </g>
    </g>
  );
};

export const Anvil: React.FC<{x: number; y: number; scale?: number}> = ({x, y, scale = 1}) => (
  <g transform={`translate(${x},${y}) scale(${scale})`}>
    <ellipse cx={0} cy={4} rx={110} ry={16} fill="rgba(0,0,0,0.35)" />
    <path d="M-120,-74 L92,-74 L74,-44 L32,-40 L44,0 L-44,0 L-32,-40 L-70,-44 Q-110,-50 -120,-74 Z" fill="#4a4d52" stroke={L} strokeWidth={SW} strokeLinejoin="round" />
    <path d="M-112,-70 L88,-70" stroke="#9aa0a8" strokeWidth={6} strokeLinecap="round" />
  </g>
);

// Hammer pivoting at its handle end; head points to -x at angle 0.
export const Hammer: React.FC<{x: number; y: number; angle: number; scale?: number}> = ({x, y, angle, scale = 1}) => (
  <g transform={`translate(${x},${y}) scale(${scale}) rotate(${angle})`}>
    <rect x={-290} y={-13} width={300} height={26} rx={12} fill="#8a5a2e" stroke={L} strokeWidth={SW} />
    <rect x={-340} y={-58} width={96} height={116} rx={12} fill="#6b7078" stroke={L} strokeWidth={SW} />
    <rect x={-332} y={-50} width={20} height={100} rx={6} fill="#a4aab2" />
  </g>
);

// A slanted name card: big name, small class line.
export const NameCard: React.FC<{x: number; y: number; name: string; sub: string; accent?: string; p: number; w?: number}> = ({x, y, name, sub, accent = C.gold, p, w = 300}) => {
  if (p <= 0.01) return null;
  return (
    <g transform={`translate(${x},${y + (1 - p) * 60}) skewX(-10)`} opacity={Math.min(1, p * 1.5)}>
      <rect x={-w / 2 + 8} y={-40 + 8} width={w} height={112} rx={10} fill={L} />
      <rect x={-w / 2} y={-40} width={w} height={112} rx={10} fill="url(#g-plate)" stroke={accent} strokeWidth={5} />
      <text x={0} y={16} textAnchor="middle" fontFamily={FONT_HEAD} fontWeight={900} fontSize={58} fill={accent} style={{letterSpacing: 3}}>
        {name}
      </text>
      <text x={0} y={56} textAnchor="middle" fontFamily={FONT_BODY} fontWeight={700} fontSize={26} fill={C.ink}>
        {sub}
      </text>
    </g>
  );
};

export const Burst: React.FC<{x: number; y: number; r: number; color?: string; points?: number; rot?: number; opacity?: number}> = ({x, y, r, color = "#fff", points = 14, rot = 0, opacity = 1}) => {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + (rot * Math.PI) / 180;
    const rr = i % 2 === 0 ? r : r * 0.55;
    pts.push(`${x + Math.cos(a) * rr},${y + Math.sin(a) * rr}`);
  }
  return <polygon points={pts.join(" ")} fill={color} stroke={L} strokeWidth={6} strokeLinejoin="round" opacity={opacity} />;
};

export const BigStar: React.FC<{x: number; y: number; s: number; color?: string}> = ({x, y, s, color = "#fff"}) => (
  <path d={starPath(s)} transform={`translate(${x},${y})`} fill={color} stroke={L} strokeWidth={4} />
);
