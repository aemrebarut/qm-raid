// Orders bar: one card per proposed (autopilot) order with a countdown ring to vetoDeadline
// and Cancel / Adjust / Go now. Cards are diffed, not rebuilt, so the ticking ring never eats clicks.
import { api, type Bus, type Order, type Reply, type State } from "../core";
import { h, safeColor } from "./dom";

const VETO_MS = 15_000; // contract veto window; used to scale the ring
const R = 15;
const CIRC = 2 * Math.PI * R;
const SVG = "http://www.w3.org/2000/svg";

interface Card { el: HTMLElement; ring: SVGCircleElement; secs: HTMLElement; title: HTMLElement; reason: HTMLElement; deadline: number | null; unitId: string }

export class OrdersBar {
  private head = h("h3", { class: "hud-orders-head" }, "Autopilot proposals");
  readonly root = h("section", { class: "hud-orders", hidden: true }, this.head);
  private cards = new Map<string, Card>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private bus: Bus) {
    bus.on("command", () => this.markAdjusting());
  }

  setState(s: State): void {
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
    this.root.hidden = this.cards.size === 0;
    this.head.textContent = this.cards.size > 1 ? `Autopilot proposals (${this.cards.size})` : "Autopilot proposal";
    const cmd = this.bus.command;
    if (cmd?.kind === "adjust" && gone.has(cmd.orderId)) this.bus.setCommand(null); // its card just went away
    this.markAdjusting();
    this.tick();
    if (this.cards.size && !this.timer) this.timer = setInterval(() => this.tick(), 250);
    if (!this.cards.size && this.timer) { clearInterval(this.timer); this.timer = null; }
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
        h("button", { class: "hud-btn hud-btn-sm hud-btn-go", type: "button", title: "Approve now", onclick: () => this.act(api.goOrder(id), "Order approved") }, "Go now"),
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
    for (const c of this.cards.values()) {
      const left = c.deadline == null ? VETO_MS : Math.max(0, c.deadline - now);
      const frac = Math.min(1, left / VETO_MS);
      c.ring.setAttribute("stroke-dashoffset", String(CIRC * (1 - frac)));
      c.secs.textContent = c.deadline == null ? "∞" : String(Math.ceil(left / 1000));
      c.el.dataset.urgent = String(c.deadline != null && left < 5000);
    }
  }
}
