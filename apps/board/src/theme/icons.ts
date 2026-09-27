// Monoline SVG icon set on a 24 px grid (hand-written, original). Stroke uses currentColor, so icons take
// the text colour of their parent. icon(name, size?) returns a fresh <svg class="lk-icon">: 1em square by
// default (size it with font-size), or size px when given.
const P: Record<string, string> = {
  // Resources
  tokens: '<ellipse cx="12" cy="6.5" rx="7" ry="2.8"/><path d="M5 6.5v5.5c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6.5M5 12v5.5c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V12"/>',
  spend: '<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.3c-.5-.8-1.4-1.3-2.6-1.3-1.5 0-2.6.8-2.6 1.9 0 2.7 5.3 1.4 5.3 4.1 0 1.1-1.1 2-2.7 2-1.2 0-2.1-.5-2.6-1.3M12 6.3V8M12 16v1.7"/>',
  pages: '<path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2zM12 6.5v13"/>',
  agents: '<circle cx="12" cy="7.5" r="3.2"/><path d="M5.5 20v-2c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5v2"/>',
  issues: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  signal: '<path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.8a7.8 7.8 0 0 1 11 0M9.5 16a3.6 3.6 0 0 1 5 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
  // Commands
  order: '<path d="M4.5 4.5l11 11M13 18l5-5M15.5 15.5l4 4M19.5 4.5l-11 11M6 13l5 5M8.5 15.5l-4 4"/>',
  message: '<path d="M4.5 5.5h15v10h-8.5l-4.5 4v-4h-2z"/>',
  recall: '<path d="M4 10v9c3.2 0 6 .5 8 2 2-1.5 4.8-2 8-2v-9M12 21v-9M12 3v5.5M9 5.5L12 3l3 2.5"/>',
  remember: '<path d="M19.5 4C13 4.5 8.8 9 7.5 15.5L6 20.5M8.3 12.5H13c3-1.8 5.5-4.5 6.5-8.5M4 20.5h9"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5.2a.8.8 0 0 1-.8.8H4.8a.8.8 0 0 1-.8-.8V6.8a.8.8 0 0 1 .8-.8H10"/>',
  retire: '<path d="M7 20V9.5a5 5 0 0 1 10 0V20M4.5 20h15M9.5 12.5h5M12 10v6"/>',
  focus: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2.2"/>',
  formation: '<circle cx="4.5" cy="15" r="2.3"/><circle cx="12" cy="15" r="2.3"/><circle cx="19.5" cy="15" r="2.3"/><path d="M6.8 15h2.9M14.3 15h2.9M19.5 12.7C18.5 6 5.5 6 4.5 12.7"/><path d="M4.5 12.7l-1.4-1.9M4.5 12.7l2-1.1"/>',
  train: '<path d="M12 3l7 2.8v5.4c0 4.4-2.9 7.9-7 9.8-4.1-1.9-7-5.4-7-9.8V5.8z"/><path d="M12 9v6M9 12h6"/>',
  attack: '<path d="M4.5 4.5l11 11M13 18l5-5M15.5 15.5l4 4M19.5 4.5l-11 11M6 13l5 5M8.5 15.5l-4 4"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  spawn: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/><circle cx="12" cy="12" r="2.2"/>',
  adjust: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  go: '<path d="M7 5l11 7-11 7z"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  mouse: '<rect x="7" y="3.5" width="10" height="17" rx="5"/><path d="M12 3.5v6M7 9.5h10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M9.8 13.3l-5 3.2M14.2 13.3l5 3.2M12 9.5V3.5"/>',
  // Unit classes
  knight: '<path d="M12 3l7 2.8v5.4c0 4.4-2.9 7.9-7 9.8-4.1-1.9-7-5.4-7-9.8V5.8z"/><path d="M12 6.5V18M7.5 10.5h9"/>',
  ranger: '<path d="M8 3c6 2.8 8.5 6 8.5 9s-2.5 6.2-8.5 9M8 3v18M3.5 12h16M17 9.5l2.5 2.5-2.5 2.5"/>',
  scout: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2.3 4.7-4.7 2.3 2.3-4.7z"/><path d="M12 3.5v1.5M12 19v1.5M3.5 12H5M19 12h1.5"/>',
  oracle: '<circle cx="12" cy="10.5" r="6"/><path d="M8 20.5h8M9.8 16.2L9 20.5M14.2 16.2l.8 4.3M9.5 9a2.8 2.8 0 0 1 2.5-1.8"/>',
  forged: '<path d="M4 19.5h16M7.5 19.5l1.2-4h6.6l1.2 4M5 8.5h9.5l3.5-2v7.5h-3.5L5 12z"/>',
  // Targets and buildings
  bug: '<ellipse cx="12" cy="13.5" rx="5" ry="6"/><path d="M12 8v11.5M9 5.5l1.4 2.4M15 5.5l-1.4 2.4M7 11.5H4M7 15.5l-3 1.5M17 11.5h3M17 15.5l3 1.5"/>',
  camp: '<path d="M6 21V8.5l2-1V4h2v2h4V4h2v3.5l2 1V21zM10 21v-3.5a2 2 0 0 1 4 0V21"/>',
  library: '<path d="M3 9l9-5 9 5M5 9.5v8.5M9.5 9.5v8.5M14.5 9.5v8.5M19 9.5v8.5M3 20.5h18"/>',
  barracks: '<path d="M3 20.5h18M5 20.5v-8l7-5 7 5v8M10 20.5v-5h4v5M12 7.5V3l3.5 1.2L12 5.4"/>',
  forge: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6 0-3.5 3-5.5 3.5-9 2 1.5 3 3 3 5 1-1 1.5-2 1.5-3.5 2.5 2 4.5 4.8 4.5 7.5 0 3.4-2.6 6-6 6z"/>',
  // Feed kinds
  tool: '<path d="M14.8 3.6a5 5 0 0 0-4.4 7.1L3.8 17.3l2.9 2.9 6.6-6.6a5 5 0 0 0 7.1-4.4l-3 1.3-2.8-2.8z"/>',
  thinking: '<circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  error: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  reply: '<path d="M9 7l-5 5 5 5M4 12h11a5 5 0 0 1 5 5v1"/>',
  you: '<path d="M4 18.5h16M5 15.5l-1-8.5 5 4 3-6.5 3 6.5 5-4-1 8.5z"/>',
  handoff: '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>',
  page: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 15.5h6"/>',
  dot: '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
};

const NS = "http://www.w3.org/2000/svg";

export function icon(name: string, size?: number, cls = ""): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  if (size) { svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size)); }
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `lk-icon${cls ? ` ${cls}` : ""}`);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = P[name] ?? P.dot; // constant markup from this file only
  return svg;
}

export function hasIcon(name: string): boolean {
  return name in P;
}

/** Icon for a unit class; forged types share the anvil. */
export function classIcon(cls: string): string {
  return ["knight", "ranger", "scout", "oracle"].includes(cls) ? cls : "forged";
}

/** Icon for a feed entry or memory op kind. */
export function kindIcon(kind: string): string {
  return ({
    message: "message", tool: "tool", thinking: "thinking", error: "error", recall: "recall", remember: "remember",
    link: "link", order: "order", reply: "reply", you: "you", handoff: "handoff",
  } as Record<string, string>)[kind] ?? "dot";
}
