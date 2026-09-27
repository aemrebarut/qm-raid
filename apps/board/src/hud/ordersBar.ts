// Orders bar: team workflow runs (node chain, loop count, Cancel), then one card per proposed
// (autopilot) order with a countdown ring to vetoDeadline and Cancel / Adjust / Go now.
// Cards are diffed, not rebuilt, so the ticking ring never eats clicks.
import { api, type Bus, type Order, type Reply, type State, type Team, type WorkflowRun } from "../core";
import { h, safeColor } from "./dom";
import { activeStep, columns, nodeStates } from "./formation";

const VETO_MS = 15_000; // contract veto window; used to scale the ring
const R = 15;
const CIRC = 2 * Math.PI * R;
const SVG = "http://www.w3.org/2000/svg";

const DONE_LINGER_MS = 8_000; // a finished or cancelled run stays this long
const ALERT_LINGER_MS = 5 * 60_000; // a run that needs a human or failed stays until dismissed, at most this long

interface Card { el: HTMLElement; ring: SVGCircleElement; secs: HTMLElement; title: HTMLElement; reason: HTMLElement; deadline: number | null; unitId: string }
interface RunCard { el: HTMLElement; title: HTMLElement; sub: HTMLElement; chain: HTMLElement; cancel: HTMLButtonElement; dismiss: HTMLButtonElement; chainSig: string; teamId: number; orderId: string | null; expires: number }

export class OrdersBar {
  private runHead = h("h3", { class: "hud-orders-head" }, "Runs");
  private head = h("h3", { class: "hud-orders-head", title: "Autopilot proposals: veto, adjust or approve" }, "Proposals");
  readonly root = h("section", { class: "hud-orders", hidden: true }, this.runHead, this.head);
  private cards = new Map<string, Card>();
  private runs = new Map<string, RunCard>();
  private seen = new Map<string, WorkflowRun["status"]>(); // last status per run, to spot endings
  private endedAt = new Map<string, number>();
  private dismissed = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private bus: Bus) {
    bus.on("command", () => this.markAdjusting());
  }

  private last: State | null = null;

  setState(s: State): void {
    this.last = s;
    this.renderRuns(s);
    const proposed = s.orders.filter((o) => o.status === "proposed");
    const live = new Set(proposed.map((o) => o.id));
    const gone = new Set<string>();
    for (const [id, c] of this.cards) if (!live.has(id)) { c.el.remove(); this.cards.delete(id); gone.add(id); }
    for (const o of proposed) {
      const c = this.cards.get(o.id) ?? this.add(o);
      c.deadline = o.vetoDeadline;
      c.unitId = o.unitId; // Adjust can move the same order to another unit
      const u = s.units.find((x) => x.id === o.unitId);
      const t = s.targets.find((x) => x.id === o.targetId);
      const team = u ? s.teams.find((x) => x.id === u.team) : undefined;
      c.el.style.setProperty("--team", safeColor(team?.color));
      c.title.textContent = `${u?.name ?? o.unitId} → ${t ? `${t.issue}: ${t.title}` : o.targetId}`;
      const reason = (o as Order & { reason?: string }).reason;
      c.reason.textContent = reason ?? "";
      c.reason.hidden = !reason;
    }
    this.root.hidden = this.cards.size === 0 && this.runs.size === 0;
    this.head.hidden = this.cards.size === 0;
    this.head.textContent = this.cards.size > 1 ? `Proposals ${this.cards.size}` : "Proposal";
    const cmd = this.bus.command;
    if (cmd?.kind === "adjust" && gone.has(cmd.orderId)) this.bus.setCommand(null); // its card just went away
    this.markAdjusting();
    this.tick();
    const busy = this.cards.size + this.runs.size > 0;
    if (busy && !this.timer) this.timer = setInterval(() => this.tick(), 250);
    if (!busy && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // One card per running run, plus recent endings (done briefly; needs a human or failed until dismissed).
  private renderRuns(s: State): void {
    const now = Date.now();
    const show = new Map<string, { run: WorkflowRun; expires: number }>();
    for (const run of s.workflowRuns) {
      const prev = this.seen.get(run.id);
      this.seen.set(run.id, run.status);
      if (run.status === "running") { this.endedAt.delete(run.id); show.set(run.id, { run, expires: Infinity }); continue; }
      if (prev === "running" || (prev === undefined && !this.endedAt.has(run.id))) this.endedAt.set(run.id, prev === "running" ? now : (run.steps.at(-1)?.ts ?? 0));
      if (this.dismissed.has(run.id)) continue;
      const alert = run.status === "needs_human" || run.status === "failed";
      const expires = (this.endedAt.get(run.id) ?? 0) + (alert ? ALERT_LINGER_MS : DONE_LINGER_MS);
      if (expires > now) show.set(run.id, { run, expires });
    }
    for (const [id, c] of this.runs) if (!show.has(id)) { c.el.remove(); this.runs.delete(id); }
    for (const { run, expires } of show.values()) {
      const team = s.teams.find((t) => t.id === run.teamId);
      const c = this.runs.get(run.id) ?? this.addRun(run);
      c.expires = expires;
      c.teamId = run.teamId;
      this.updateRun(s, c, run, team);
    }
    this.runHead.hidden = this.runs.size === 0;
    this.runHead.textContent = this.runs.size > 1 ? `Runs ${this.runs.size}` : "Run";
  }

  private addRun(run: WorkflowRun): RunCard {
    const id = run.id;
    const title = h("div", { class: "hud-card-title" });
    const sub = h("div", { class: "hud-card-reason" });
    const chain = h("div", { class: "hud-run-chain" });
    const cancel = h("button", { class: "hud-btn hud-btn-sm hud-btn-cancel", type: "button", title: "Cancel this run (stops its active order)",
      onclick: () => card.orderId && void this.act(api.cancelOrder(card.orderId), "Run cancelled") }, "Cancel");
    const dismiss = h("button", { class: "hud-btn hud-btn-sm", type: "button", title: "Hide this card",
      onclick: () => { this.dismissed.add(id); card.el.remove(); this.runs.delete(id); this.root.hidden = this.cards.size === 0 && this.runs.size === 0; } }, "Dismiss");
    const el = h("article", { class: "hud-card hud-run-card", "data-run": id },
      h("div", { class: "hud-card-body", title: "Select the team", onclick: () => this.selectTeam(card.teamId) }, title, chain, sub),
      h("div", { class: "hud-card-btns" }, cancel, dismiss));
    const card: RunCard = { el, title, sub, chain, cancel, dismiss, chainSig: "", teamId: run.teamId, orderId: null, expires: Infinity };
    this.runs.set(id, card);
    this.root.insertBefore(el, this.head); // runs sit above the proposals
    return card;
  }

  private updateRun(s: State, c: RunCard, run: WorkflowRun, team: Team | undefined): void {
    const wf = team?.workflow;
    const t = s.targets.find((x) => x.id === run.targetId);
    const act = activeStep(run);
    c.orderId = run.status === "running" ? act?.orderId ?? null : null;
    c.el.style.setProperty("--team", safeColor(team?.color));
    c.el.dataset.status = run.status;
    c.title.textContent = `${team?.name ?? `Team ${run.teamId}`} vs ${t ? `${t.issue}: ${t.title}` : run.targetId}`;
    const role = (nodeId: string) => wf?.nodes.find((n) => n.id === nodeId)?.role ?? nodeId;
    const name = (unitId: string) => s.units.find((u) => u.id === unitId)?.name ?? unitId;
    const loops = `loop ${run.loops}/${wf?.maxLoops ?? "?"}`;
    c.sub.textContent = run.status === "running"
      ? `${run.active.map((n) => { const st = [...run.steps].reverse().find((x) => x.nodeId === n); return `${cap(role(n))} ${st ? name(st.unitId) : ""}`.trim(); }).join(", ") || "Starting"} working · ${loops}`
      : `${STATUS_TEXT[run.status] ?? run.status} · ${loops}`;
    c.cancel.hidden = run.status !== "running" || !c.orderId;
    c.dismiss.hidden = run.status === "running";
    // Node chain: one pip per node, columns in graph order, coloured by the node's latest state.
    const states = nodeStates(run);
    const cols = wf ? columns(wf) : [];
    const sig = cols.map((col) => col.map((n) => `${n}:${states.get(n) ?? "idle"}`).join("+")).join(">");
    if (sig === c.chainSig) return;
    c.chainSig = sig;
    c.chain.replaceChildren(...cols.flatMap((col, i) => [
      i ? h("span", { class: "hud-run-link" }) : null,
      h("span", { class: "hud-run-col" }, col.map((n) => h("span", { class: "hud-run-pip", "data-state": states.get(n) ?? "idle", title: `${cap(role(n))} (${states.get(n) ?? "waiting"})` }, role(n).charAt(0).toUpperCase()))),
    ].filter((x): x is HTMLElement => !!x)));
  }

  private selectTeam(teamId: number): void {
    const members = this.last?.teams.find((t) => t.id === teamId)?.members ?? [];
    if (members.length) this.bus.select([...members]);
  }

  private add(o: Order): Card {
    const ring = document.createElementNS(SVG, "circle");
    ring.setAttribute("class", "hud-ring-fg");
    for (const [k, v] of [["cx", "18"], ["cy", "18"], ["r", String(R)]]) ring.setAttribute(k, v);
    ring.setAttribute("stroke-dasharray", String(CIRC));
    const bg = document.createElementNS(SVG, "circle");
    bg.setAttribute("class", "hud-ring-bg");
    for (const [k, v] of [["cx", "18"], ["cy", "18"], ["r", String(R)]]) bg.setAttribute(k, v);
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 36 36");
    svg.setAttribute("class", "hud-ring");
    svg.append(bg, ring);

    const secs = h("span", { class: "hud-ring-secs" });
    const title = h("div", { class: "hud-card-title" });
    const reason = h("div", { class: "hud-card-reason" });
    const id = o.id;
    const el = h("article", { class: "hud-card", "data-order": id },
      h("div", { class: "hud-ring-wrap", title: "Time left to veto" }, svg, secs),
      h("div", { class: "hud-card-body", title: "Click to select the unit", onclick: () => this.bus.select([card.unitId]),
          onmouseenter: () => this.bus.hover({ kind: "unit", id: card.unitId }), onmouseleave: () => this.bus.hover(null) },
        title, reason),
      h("div", { class: "hud-card-btns" },
        h("button", { class: "hud-btn hud-btn-sm hud-btn-cancel", type: "button", title: "Veto this order", onclick: () => this.act(api.cancelOrder(id), "Order vetoed") }, "Cancel"),
        h("button", { class: "hud-btn hud-btn-sm", type: "button", title: "Pick another target or unit for this order",
          onclick: () => this.bus.setCommand(this.bus.command?.kind === "adjust" && this.bus.command.orderId === id ? null : { kind: "adjust", orderId: id }) }, "Adjust"),
        h("button", { class: "hud-btn hud-btn-sm hud-btn-go", type: "button", title: "Approve now", onclick: () => this.act(api.goOrder(id), "Order approved") }, "Go"),
      ),
    );
    const card: Card = { el, ring, secs, title, reason, deadline: o.vetoDeadline, unitId: o.unitId }; // handlers read it later
    this.cards.set(id, card);
    this.root.append(el);
    return card;
  }

  private async act(p: Promise<Reply>, ok: string): Promise<void> {
    const r = await p;
    this.bus.toast(r.ok ? ok : r.error, r.ok ? "info" : "error");
  }

  private markAdjusting(): void {
    const cmd = this.bus.command;
    for (const [id, c] of this.cards) c.el.dataset.adjusting = String(cmd?.kind === "adjust" && cmd.orderId === id);
  }

  private tick(): void {
    const now = Date.now();
    let expired = false;
    for (const c of this.runs.values()) if (c.expires <= now) expired = true;
    if (expired && this.last) this.setState(this.last);
    for (const c of this.cards.values()) {
      const left = c.deadline == null ? VETO_MS : Math.max(0, c.deadline - now);
      const frac = Math.min(1, left / VETO_MS);
      c.ring.setAttribute("stroke-dashoffset", String(CIRC * (1 - frac)));
      c.secs.textContent = c.deadline == null ? "∞" : String(Math.ceil(left / 1000));
      c.el.dataset.urgent = String(c.deadline != null && left < 5000);
    }
  }
}

const STATUS_TEXT: Record<string, string> = { done: "Done", needs_human: "Needs you: loops used up", failed: "Failed", cancelled: "Cancelled" };

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
