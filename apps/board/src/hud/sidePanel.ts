// Right side panel: the selected unit (details, order, live feed, reply, message box) or target.
import { api, type Building, type Bus, type FeedEntry, type Order, type Selection, type State, type Store, type Target, type Unit } from "../core";
import { clear, h, put, safeUrl, timeOf } from "./dom";

type FeedItem = Omit<FeedEntry, "kind" | "unitId"> & { kind: FeedEntry["kind"] | "you" | "link" };

const FEED_SHOWN = 40;

const KIND_ICON: Record<string, string> = {
  message: "\u{1F4AC}", tool: "\u{1F6E0}", thinking: "\u{1F4AD}", error: "⚠",
  recall: "\u{1F4D6}", remember: "\u{1F4DC}", link: "\u{1F517}", order: "⚔", reply: "✉", you: "\u{1F451}",
};

export class SidePanel {
  readonly root = h("aside", { class: "hud-side hud-parchment", "data-empty": "true" });
  private body = h("div", { class: "hud-side-body" });
  private replySlot = h("div");
  private feedFor: string | null = null;
  private feedLast: unknown = null;
  private sent = new Map<string, FeedItem[]>(); // the user's own messages, merged into the feed
  private feed = h("ol", { class: "hud-feed" });
  private feedWrap = h("section", { class: "hud-section" }, h("h3", null, "Activity"), this.feed);
  private msg = new MessageBox((text) => this.send(text));
  private sel: Selection = { units: [], target: null, building: null, focus: null };
  private state: State | null = null;

  constructor(private store: Store, private bus: Bus) {
    // Feed and message box stay attached (only hidden) so typing focus survives re-renders.
    this.root.append(this.body, this.feedWrap, this.replySlot, this.msg.el);
    store.onEvent(() => {
      const id = this.focusUnitId();
      if (id && this.feedFor === id && store.feed(id).at(-1) !== this.feedLast) this.renderFeed();
    });
  }

  setState(s: State): void {
    this.state = s;
    this.render();
  }

  setSelection(sel: Selection): void {
    const prevUnit = this.focusUnitId();
    this.sel = sel;
    if (this.focusUnitId() !== prevUnit) this.msg.reset();
    this.render();
  }

  /** Focus the message box (command grid "Message"). */
  focusMessage(): void {
    if (!this.msg.el.hidden) this.msg.focus();
  }

  private focusUnitId(): string | null {
    return this.sel.focus === "units" && this.sel.units.length === 1 ? this.sel.units[0] : null;
  }

  private render(): void {
    const s = this.state;
    clear(this.body);
    clear(this.replySlot);
    const unitView = !!s && this.focusUnitId() !== null && s.units.some((u) => u.id === this.focusUnitId());
    this.feedWrap.hidden = !unitView;
    this.msg.el.hidden = !unitView;
    if (!unitView) this.feedFor = null;
    this.root.dataset.empty = "false";
    if (!s) return void put(this.body, h("p", { class: "hud-hint" }, "Waiting for the engine..."));
    const sel = this.sel;
    const units = sel.units.map((id) => s.units.find((u) => u.id === id)).filter((u): u is Unit => !!u);
    const target = sel.target ? s.targets.find((t) => t.id === sel.target) : undefined;
    const building = sel.building ? s.buildings.find((b) => b.id === sel.building) : undefined;
    if (sel.focus === "target" && target) this.renderTarget(s, target);
    else if (sel.focus === "building" && building) this.renderBuilding(s, building);
    else if (units.length === 1) this.renderUnit(s, units[0]);
    else if (units.length > 1) this.renderRoster(s, units);
    else {
      this.root.dataset.empty = "true";
      put(this.body, h("p", { class: "hud-hint" }, "Select a unit, an enemy camp or a building."));
    }
  }

  private renderUnit(s: State, u: Unit): void {
    const team = s.teams.find((t) => t.id === u.team);
    const order = u.orderId ? s.orders.find((o) => o.id === u.orderId) : undefined;
    const target = order ? s.targets.find((t) => t.id === order.targetId) : undefined;
    const lastReply = [...s.orders].reverse().find((o) => o.unitId === u.id && o.reply);
    const qmUrl = safeUrl(u.qm?.sessionUrl);

    put(this.body, 
      h("header", { class: "hud-side-head" },
        h("div", { class: "hud-portrait", "data-class": u.class, style: `--team:${team?.color ?? "#8a7a5c"}` }, classGlyph(u.class)),
        h("div", null,
          h("h2", null, u.name),
          h("div", { class: "hud-sub" }, `${u.class}${team ? ` · ${team.name}` : ""}`),
          statusPill(u.status),
        ),
      ),
      h("dl", { class: "hud-stats" },
        row("Model", u.model), row("Effort", u.effort), row("Role", u.role),
        row("Tile", `${u.pos.x}, ${u.pos.y}`),
      ),
      h("section", { class: "hud-section" },
        h("h3", null, "Order"),
        order
          ? h("div", { class: "hud-order" },
              h("div", null, target ? `${target.issue}: ${target.title}` : order.targetId),
              h("div", { class: "hud-sub" }, `${order.status} · ${order.source === "autopilot" ? "autopilot" : "you"}`))
          : h("div", { class: "hud-sub" }, "No order. Right-click a camp to send this unit."),
      ),
      qmUrl ? h("a", { class: "hud-btn hud-qm", href: qmUrl, target: "_blank", rel: "noopener noreferrer" }, "Open in QM") : null,
    );
    if (lastReply) this.replySlot.append(h("section", { class: "hud-section" }, h("h3", null, "Last reply"), h("div", { class: "hud-reply" }, lastReply.reply)));
    if (this.feedFor !== u.id) this.renderFeed();
  }

  private renderFeed(): void {
    const id = this.focusUnitId();
    if (!id) return;
    const fresh = this.feedFor !== id;
    this.feedFor = id;
    const top = this.feed.scrollTop;
    const stick = fresh || top + this.feed.clientHeight >= this.feed.scrollHeight - 8;
    clear(this.feed);
    const log = this.store.feed(id);
    this.feedLast = log.at(-1);
    const items: FeedItem[] = [...log, ...(this.sent.get(id) ?? [])].sort((a, b) => a.ts - b.ts).slice(-FEED_SHOWN);
    if (!items.length) this.feed.append(h("li", { class: "hud-hint" }, "Nothing yet."));
    for (const it of items) this.feed.append(feedRow(it));
    this.feed.scrollTop = stick ? this.feed.scrollHeight : top;
  }

  private renderRoster(s: State, units: Unit[]): void {
    put(this.body, 
      h("h2", null, `${units.length} units selected`),
      h("ul", { class: "hud-roster" },
        units.map((u) => {
          const team = s.teams.find((t) => t.id === u.team);
          return h("li", null,
            h("button", { class: "hud-roster-item", onclick: () => this.bus.select([u.id]) },
              h("span", { class: "hud-portrait hud-portrait-sm", "data-class": u.class, style: `--team:${team?.color ?? "#8a7a5c"}` }, classGlyph(u.class)),
              h("span", null, u.name),
              statusPill(u.status),
            ));
        }),
      ),
      h("p", { class: "hud-hint" }, "Right-click a camp to order them all. Click a name to focus one."),
    );
  }

  private renderTarget(s: State, t: Target): void {
    const comp = s.components.find((c) => c.id === t.component);
    const engaged = s.orders.filter((o) => o.targetId === t.id && (o.status === "active" || o.status === "proposed"));
    const lastReply = [...s.orders].reverse().find((o) => o.targetId === t.id && o.reply);
    put(this.body, 
      h("header", { class: "hud-side-head" },
        h("div", { class: "hud-portrait hud-portrait-foe", "data-kind": t.kind }, t.kind === "bug" ? "\u{1F47E}" : "\u{1F3F0}"),
        h("div", null,
          h("h2", null, t.title),
          h("div", { class: "hud-sub" }, `${t.issue} · ${t.kind} · ${comp?.name ?? t.component}`),
          h("span", { class: `hud-pill hud-target-${t.status}` }, t.status),
        ),
      ),
      h("dl", { class: "hud-stats" }, row("Severity", "⚔".repeat(t.severity) + ` (${t.severity}/3)`), row("Tile", `${t.pos.x}, ${t.pos.y}`)),
      h("section", { class: "hud-section" },
        h("h3", null, "Customers"),
        t.customers.length
          ? h("ul", { class: "hud-list" }, t.customers.map((c) => h("li", null, prettySlug(c))))
          : h("div", { class: "hud-sub" }, "None recorded."),
      ),
      h("section", { class: "hud-section" },
        h("h3", null, "Engaged by"),
        engaged.length
          ? h("ul", { class: "hud-list" }, engaged.map((o) => h("li", null, orderLine(s, o))))
          : h("div", { class: "hud-sub" }, "Nobody yet. Select units, then right-click this camp."),
      ),
      lastReply ? h("section", { class: "hud-section" }, h("h3", null, "Last report"), h("div", { class: "hud-reply" }, lastReply.reply)) : null,
    );
  }

  private renderBuilding(s: State, b: Building): void {
    const info = BUILDINGS[b.kind] ?? { name: b.id, glyph: "\u{1F3DB}", blurb: "" };
    const idle = s.units.filter((u) => u.status === "idle").length;
    put(this.body, 
      h("header", { class: "hud-side-head" },
        h("div", { class: "hud-portrait hud-portrait-building", "data-kind": b.kind }, info.glyph),
        h("div", null, h("h2", null, info.name), h("div", { class: "hud-sub" }, info.blurb)),
      ),
      h("dl", { class: "hud-stats" },
        b.kind === "gbrain" ? row("Pages", String(s.memory.pages)) : null,
        b.kind === "barracks" ? row("Idle agents", String(idle)) : null,
        b.kind === "river" ? row("Unit types", String((s.unitTypes ?? []).filter((t) => t.source === "forge").length)) : null,
        row("Tile", `${b.x}, ${b.y}`),
      ),
      b.kind === "gbrain" && s.memory.recent.length
        ? h("section", { class: "hud-section" },
            h("h3", null, "Recent memory"),
            h("ol", { class: "hud-feed" }, s.memory.recent.slice(-12).map((m) =>
              feedRow({ ts: m.ts, kind: m.op, text: `${m.unitId ? `${unitName(s, m.unitId)}: ` : ""}${m.summary || m.slugs.join(", ")}` }))),
          )
        : null,
    );
  }

  private async send(text: string): Promise<string | null> {
    const id = this.focusUnitId();
    if (!id) return "No unit selected.";
    const res = await api.message(id, text);
    if (!res.ok) {
      const error = res.error || "Send failed.";
      // The box may show another unit by now; do not lose the failure.
      if (this.focusUnitId() !== id) this.bus.toast(`Message to ${this.store.unit(id)?.name ?? id} failed: ${error}`, "error");
      return error;
    }
    const mine = this.sent.get(id) ?? [];
    mine.push({ ts: Date.now(), kind: "you", text });
    this.sent.set(id, mine.slice(-20));
    if (this.focusUnitId() === id) this.renderFeed();
    return null;
  }
}

// Persistent message box: survives re-renders so typed text and focus are not lost.
class MessageBox {
  private input = h("textarea", { class: "hud-input", rows: 2, placeholder: "Message this agent (Enter to send)" });
  private button = h("button", { class: "hud-btn", type: "submit" }, "Send");
  private note = h("div", { class: "hud-note" });
  private gen = 0;
  readonly el = h("form", { class: "hud-section hud-msg" }, h("h3", null, "Orders"), this.input, h("div", { class: "hud-msg-row" }, this.note, this.button));

  constructor(private onSend: (text: string) => Promise<string | null>) {
    this.el.addEventListener("submit", (e) => { e.preventDefault(); void this.submit(); });
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // keep WASD and hotkeys out of the scene while typing (keyup still bubbles so held keys release)
      if (e.key === "Escape") { this.input.blur(); return; }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void this.submit(); }
    });
  }

  focus(): void {
    this.input.focus();
  }

  // A new unit was focused: clear the box and orphan any send still in flight.
  reset(): void {
    this.gen++;
    this.input.value = "";
    this.note.textContent = "";
    this.button.disabled = false;
  }

  private async submit(): Promise<void> {
    const draft = this.input.value;
    const text = draft.trim();
    if (!text || this.button.disabled) return;
    const gen = ++this.gen;
    this.button.disabled = true;
    this.note.textContent = "Sending...";
    this.note.dataset.error = "false";
    const err = await this.onSend(text);
    if (gen !== this.gen) return; // another unit is shown now (or a newer send); leave its UI alone
    this.button.disabled = false;
    this.note.textContent = err ?? "Sent.";
    this.note.dataset.error = err ? "true" : "false";
    if (!err && this.input.value === draft) this.input.value = ""; // keep edits made while sending
  }
}

function row(k: string, v: string | null | undefined) {
  return [h("dt", null, k), h("dd", null, v ?? "-")];
}

export function statusPill(status: string) {
  return h("span", { class: `hud-pill hud-st-${status}` }, status.replace("_", " "));
}

export function classGlyph(cls: string): string {
  return ({ knight: "♞", ranger: "\u{1F3F9}", scout: "\u{1F9ED}", oracle: "\u{1F52E}" } as Record<string, string>)[cls] ?? "⚒";
}

function feedRow(it: FeedItem) {
  return h("li", { class: `hud-feed-${it.kind}` },
    h("span", { class: "hud-feed-time" }, timeOf(it.ts)),
    h("span", { class: "hud-feed-icon" }, KIND_ICON[it.kind] ?? "•"),
    it.tool ? h("code", null, it.tool) : null,
    h("span", { class: "hud-feed-text" }, it.text),
  );
}

export const BUILDINGS: Record<string, { name: string; glyph: string; blurb: string }> = {
  gbrain: { name: "The Library", glyph: "\u{1F4DA}", blurb: "GBrain: what every agent has learned." },
  barracks: { name: "Barracks", glyph: "\u{1F6E1}", blurb: "Train new agents." },
  river: { name: "The Forge", glyph: "\u{1F525}", blurb: "River: forge new kinds of agent." },
};

function unitName(s: State, id: string): string {
  return s.units.find((u) => u.id === id)?.name ?? id;
}

function orderLine(s: State, o: Order): string {
  const u = s.units.find((x) => x.id === o.unitId);
  return `${u?.name ?? o.unitId} (${o.status}${o.source === "autopilot" ? ", autopilot" : ""})`;
}

function prettySlug(slug: string): string {
  const last = slug.split("/").pop() ?? slug;
  return last.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
