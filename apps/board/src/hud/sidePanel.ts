// Right side panel: what the selection is doing (the bottom centre shows who it is).
// Unit: order, activity, message box. Camp: customers, engaged units, report. Team: roster and formation.
import { api, type Building, type Bus, type FeedEntry, type Order, type Selection, type State, type Store, type Target, type Unit } from "../core";
import { icon, kindIcon } from "../theme/icons";
import { portraitArt } from "../theme/portrait";
import { humanize, modelLabel, orderPhrase, refreshTimes, relTime, stripName, toolPhrase } from "../theme/text";
import { BarracksPanel } from "./barracks";
import { slugChips } from "./chips";
import { h, put, RowList, safeColor, safeUrl } from "./dom";
import { FormationPanel, roleOf, teamOfSelection } from "./formation";
import { LoadoutView } from "./loadout";

type FeedItem = Omit<FeedEntry, "kind" | "unitId"> & { kind: FeedEntry["kind"] | "you" | "link" };

const FEED_SHOWN = 40;

export class SidePanel {
  readonly root = h("aside", { class: "hud-side hud-parchment", "data-empty": "true" });
  private body = h("div", { class: "hud-side-body" });
  private replySlot = h("div");
  private feedFor: string | null = null;
  private barracks: BarracksPanel;
  private formation: FormationPanel;
  private feedLast: unknown = null;
  private sent = new Map<string, FeedItem[]>(); // the user's own messages, merged into the feed
  private feed = h("ol", { class: "hud-feed" });
  private feedWrap = h("section", { class: "hud-section" }, h("h3", null, "Activity"), this.feed);
  private feedRows = new RowList<FeedItem>(this.feed, (it) => feedRow(it, this.bus, this.store.unit(this.feedFor ?? "")?.name));
  private msg = new MessageBox((text) => this.send(text));
  private sel: Selection = { units: [], target: null, building: null, focus: null };
  // Unit view tabs: Activity (order, feed, message) and Loadout (hud/loadout.ts, raid-ui-plan).
  private tab: "activity" | "loadout" = "activity";
  private tabBtns = { activity: tabBtn("Activity"), loadout: tabBtn("Loadout") };
  private tabs = h("div", { class: "hud-tabs", role: "tablist" }, this.tabBtns.activity, this.tabBtns.loadout);
  private loadout: LoadoutView;
  private loadoutFor: string | null = null;
  private state: State | null = null;

  constructor(private store: Store, private bus: Bus) {
    this.barracks = new BarracksPanel(bus);
    this.formation = new FormationPanel(store, bus);
    this.loadout = new LoadoutView(store, bus);
    this.tabBtns.activity.addEventListener("click", () => this.setTab("activity"));
    this.tabBtns.loadout.addEventListener("click", () => this.setTab("loadout"));
    // Feed, message box and loadout stay attached (only hidden) so typing focus survives re-renders.
    this.root.append(this.tabs, this.body, this.formation.root, this.barracks.root, this.feedWrap, this.replySlot, this.msg.el, this.loadout.root);
    store.onEvent(() => {
      const id = this.focusUnitId();
      if (id && this.feedFor === id && store.feed(id).at(-1) !== this.feedLast) this.renderFeed();
    });
    setInterval(() => { if (!this.feedWrap.hidden) refreshTimes(this.feed); }, 5000);
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

  // Render into detached nodes and swap only when the markup changed: moving units re-render
  // many times a second, and replacing buttons under the cursor would swallow clicks.
  private out = h("div");
  private outReply = h("div");
  private bodyHtml = "";
  private replyHtml = "";

  private render(): void {
    this.out = h("div");
    this.outReply = h("div");
    this.renderInto();
    swap(this.body, this.out, this.bodyHtml, (html) => (this.bodyHtml = html));
    swap(this.replySlot, this.outReply, this.replyHtml, (html) => (this.replyHtml = html));
  }

  private setTab(tab: "activity" | "loadout"): void {
    this.tab = tab;
    this.render();
  }

  private renderInto(): void {
    const s = this.state;
    const unitView = !!s && this.focusUnitId() !== null && s.units.some((u) => u.id === this.focusUnitId());
    const loadout = unitView && this.tab === "loadout";
    this.tabs.hidden = !unitView;
    for (const [k, b] of Object.entries(this.tabBtns)) b.setAttribute("aria-selected", String(k === this.tab));
    this.body.hidden = loadout;
    this.replySlot.hidden = loadout;
    this.feedWrap.hidden = !unitView || loadout;
    this.msg.el.hidden = !unitView || loadout;
    this.loadout.root.hidden = !loadout;
    const loFor = loadout ? this.focusUnitId() : null;
    if (loFor !== this.loadoutFor) { this.loadoutFor = loFor; this.loadout.show(loFor); }
    if (!unitView) this.feedFor = null;
    const barracks = !!s && this.sel.focus === "building" && s.buildings.find((b) => b.id === this.sel.building)?.kind === "barracks";
    this.barracks.root.hidden = !barracks;
    if (barracks && s) this.barracks.setState(s);
    this.root.dataset.empty = "false";
    if (!s) return void (this.root.dataset.empty = "true");
    const sel = this.sel;
    const units = sel.units.map((id) => s.units.find((u) => u.id === id)).filter((u): u is Unit => !!u);
    const target = sel.target ? s.targets.find((t) => t.id === sel.target) : undefined;
    const building = sel.building ? s.buildings.find((b) => b.id === sel.building) : undefined;
    if (sel.focus === "target" && target) this.renderTarget(s, target);
    else if (sel.focus === "building" && building) this.renderBuilding(s, building, barracks);
    else if (units.length === 1) this.renderUnit(s, units[0]);
    else if (units.length > 1) this.renderRoster(s, units);
    else this.root.dataset.empty = "true";
  }

  private renderUnit(s: State, u: Unit): void {
    const order = u.orderId ? s.orders.find((o) => o.id === u.orderId) : undefined;
    const target = order ? s.targets.find((t) => t.id === order.targetId) : undefined;
    const qmUrl = safeUrl(u.qm?.sessionUrl);

    put(this.out,
      order
        ? h("section", { class: "hud-section" },
            h("h3", null, "Order"),
            h("div", { class: "hud-order" },
              h("div", { class: "hud-order-title" }, target ? `${target.issue} ${target.title}` : "Camp"),
              h("div", { class: "hud-sum-row" }, h("span", { class: `hud-pill hud-order-${order.status}` }, order.status), h("span", { class: "hud-sub" }, sourceLabel(s, order)))))
        : null,
      qmUrl ? h("a", { class: "hud-btn hud-btn-sm hud-qm", href: qmUrl, target: "_blank", rel: "noopener noreferrer", title: "Open the QM session" }, icon("open"), "QM session") : null,
      u.status === "error"
        ? h("section", { class: "hud-section hud-error" }, h("h3", null, "Error"),
            h("div", null, [...this.store.feed(u.id)].reverse().find((e) => e.kind === "error")?.text ?? "Agent error"))
        : null,
    );
    if (this.feedFor !== u.id) this.renderFeed();
  }

  private renderFeed(): void {
    const id = this.focusUnitId();
    if (!id) return;
    const fresh = this.feedFor !== id;
    this.feedFor = id;
    const top = this.feed.scrollTop;
    const stick = fresh || top + this.feed.clientHeight >= this.feed.scrollHeight - 8;
    const log = this.store.feed(id);
    this.feedLast = log.at(-1);
    const items: FeedItem[] = [...log, ...(this.sent.get(id) ?? [])].sort((a, b) => a.ts - b.ts).slice(-FEED_SHOWN);
    if (fresh) this.feedRows.reset();
    this.feedRows.set(items);
    refreshTimes(this.feed);
    this.feed.scrollTop = stick ? this.feed.scrollHeight : top;
  }

  private renderRoster(s: State, units: Unit[]): void {
    const team = teamOfSelection(s, units.map((u) => u.id));
    put(this.out,
      team
        ? h("header", { class: "hud-side-head hud-team-head", style: `--team:${safeColor(team.color)}` },
            h("span", { class: "hud-team-dot" }),
            h("div", null, h("h2", null, team.name),
              h("div", { class: "hud-sum-row" },
                h("span", { class: "hud-tag" }, `Group ${team.id}`),
                h("span", { class: "hud-tag" }, `${units.length} units`),
                team.autopilot ? h("span", { class: "hud-tag", style: "color:var(--gold)" }, "Auto") : null)))
        : h("h2", null, `${units.length} selected`),
      h("ul", { class: "hud-roster" },
        units.map((u) => {
          const team = s.teams.find((t) => t.id === u.team);
          return h("li", null,
            h("button", { class: "hud-roster-item", type: "button", "data-unit": u.id, onclick: () => this.bus.select([u.id]) },
              h("span", { class: "hud-portrait hud-portrait-sm", "data-class": u.class, style: portraitStyle(u.class, team?.color) }, portraitArt(u.class, team?.color, 28)),
              h("span", { class: "hud-roster-name" }, u.name),
              roleOf(team, u.id) ? h("span", { class: "hud-role-tag" }, roleOf(team, u.id)!) : null,
              statusPill(u.status),
            ));
        }),
      ),
    );
  }

  private renderTarget(s: State, t: Target): void {
    const engaged = s.orders.filter((o) => o.targetId === t.id && (o.status === "active" || o.status === "proposed"));
    const lastReply = [...s.orders].reverse().find((o) => o.targetId === t.id && o.reply);
    const replyName = lastReply ? s.units.find((u) => u.id === lastReply.unitId)?.name : undefined;
    put(this.out,
      h("section", { class: "hud-section" },
        h("h3", null, "Engaged"),
        engaged.length
          ? h("ul", { class: "hud-roster" }, engaged.map((o) => {
              const u = s.units.find((x) => x.id === o.unitId);
              const team = u ? s.teams.find((tm) => tm.id === u.team) : undefined;
              return h("li", null, h("button", { class: "hud-roster-item", type: "button", onclick: () => u && this.bus.select([u.id]) },
                h("span", { class: "hud-portrait hud-portrait-sm", style: portraitStyle(u?.class ?? "", team?.color) }, portraitArt(u?.class ?? "knight", team?.color, 28)),
                h("span", { class: "hud-roster-name" }, u?.name ?? o.unitId),
                o.source !== "user" ? h("span", { class: "hud-role-tag" }, sourceLabel(s, o)) : null,
                h("span", { class: `hud-pill hud-order-${o.status}` }, o.status)));
            }))
          : h("div", { class: "hud-sub" }, "None"),
      ),
      h("section", { class: "hud-section" },
        h("h3", null, "Customers"),
        t.customers.length
          ? h("ul", { class: "hud-list" }, t.customers.map((c) => h("li", null, prettySlug(c))))
          : h("div", { class: "hud-sub" }, "None"),
      ),
      lastReply?.reply ? h("section", { class: "hud-section" }, h("h3", null, "Report"), clamped(stripName(lastReply.reply, replyName))) : null,
    );
  }

  private renderBuilding(s: State, b: Building, barracks: boolean): void {
    // Library and Forge open their own overlays; the Barracks section is persistent (this.barracks).
    if (!barracks) this.root.dataset.empty = "true";
    void s;
    void b;
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
  private input = h("textarea", { class: "hud-input", rows: 2, placeholder: "Message" });
  private button = h("button", { class: "hud-btn", type: "submit" }, "Send");
  private note = h("div", { class: "hud-note" });
  private gen = 0;
  readonly el = h("form", { class: "hud-section hud-msg" }, this.input, h("div", { class: "hud-msg-row" }, this.note, this.button));

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
    this.note.textContent = "Sending";
    this.note.dataset.error = "false";
    const err = await this.onSend(text);
    if (gen !== this.gen) return; // another unit is shown now (or a newer send); leave its UI alone
    this.button.disabled = false;
    this.note.textContent = err ?? "Sent";
    this.note.dataset.error = err ? "true" : "false";
    if (!err && this.input.value === draft) this.input.value = ""; // keep edits made while sending
  }
}

function swap(el: HTMLElement, next: HTMLElement, prevHtml: string, save: (html: string) => void): void {
  const html = next.innerHTML;
  if (html === prevHtml) return;
  save(html);
  el.replaceChildren(...next.childNodes);
}

function row(k: string, v: string | null | undefined) {
  return [h("dt", null, k), h("dd", null, v ?? "-")];
}

export function statusPill(status: string) {
  return h("span", { class: `hud-pill hud-st-${status}` }, status.replace("_", " "));
}

const BUILTIN_CLASSES = new Set(["knight", "ranger", "scout", "oracle"]);

/** Portrait CSS vars: team colour border, plus a stable hue for forged unit types. */
export function portraitStyle(cls: string, teamColor: string | null | undefined): string {
  if (BUILTIN_CLASSES.has(cls)) return `--team:${safeColor(teamColor)}`;
  let hash = 0;
  for (const ch of cls) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `--team:${safeColor(teamColor)};--forge-hue:${hash % 360}`;
}

function tabBtn(label: string): HTMLButtonElement {
  return h("button", { class: "hud-tab", type: "button", role: "tab", "aria-selected": "false" }, label);
}

function feedRow(it: FeedItem, bus?: Bus, name?: string) {
  const text = feedText(it, name);
  const long = text.length > 140 || text.split("\n").length > 3;
  const more = long ? h("button", { class: "hud-more hud-feed-more", type: "button", title: "Expand", "aria-expanded": "false" }, icon("chevron")) : null;
  const li = h("li", { class: `hud-feed-${it.kind}`, title: new Date(it.ts).toLocaleTimeString() },
    h("span", { class: "hud-feed-time", "data-ts": it.ts }, relTime(it.ts)),
    h("span", { class: "hud-feed-icon" }, icon(kindIcon(it.kind))),
    h("span", { class: "hud-feed-text", title: it.tool ?? null }, text, bus ? slugChips(it.slugs, bus) : null),
    more,
  );
  more?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = li.classList.toggle("hud-feed-open");
    more.setAttribute("aria-expanded", String(open));
    more.dataset.open = String(open);
    more.title = open ? "Collapse" : "Expand";
  });
  return li;
}

function feedText(it: FeedItem, name?: string): string {
  if (it.kind === "tool") return toolPhrase(it.tool, it.text, it.slugs);
  if (it.kind === "order") return orderPhrase(it.text);
  return humanize(stripName(it.text, name));
}

/** Class name for players: forged types show their Forge name ("Refund Ranger v2"), never the type id. */
export function className(s: State, cls: string): { name: string; forged: boolean } {
  if (BUILTIN_CLASSES.has(cls)) return { name: cls, forged: false };
  const t = (s.unitTypes ?? []).find((x) => x.id === cls);
  return { name: t?.name ?? cls.replace(/^forge-/, "").replace(/-/g, " "), forged: true };
}

export { modelLabel };

/** Long text clamped to four lines with an expand chevron. */
function clamped(text: string): HTMLElement {
  const body = h("div", { class: "hud-reply" }, text);
  const more = h("button", { class: "hud-more", type: "button", title: "Expand" }, icon("chevron"));
  more.addEventListener("click", () => {
    const open = body.dataset.open !== "true";
    body.dataset.open = more.dataset.open = String(open);
  });
  return h("div", { class: "hud-section" }, body, text.length > 180 || text.split("\n").length > 4 ? more : null);
}

export const BUILDINGS: Record<string, { name: string; icon: string; mark: string }> = {
  gbrain: { name: "Library", icon: "library", mark: "GBrain" },
  barracks: { name: "Barracks", icon: "barracks", mark: "" },
  river: { name: "Forge", icon: "forge", mark: "River" },
};

function unitName(s: State, id: string): string {
  return s.units.find((u) => u.id === id)?.name ?? id;
}

function orderLine(s: State, o: Order): string {
  const u = s.units.find((x) => x.id === o.unitId);
  return `${u?.name ?? o.unitId} (${o.status}${o.source === "user" ? "" : `, ${sourceLabel(s, o)}`})`;
}

/** Who gave the order: you, the autopilot, or a team workflow (with the node's role). */
function sourceLabel(s: State, o: Order): string {
  if (o.source === "autopilot") return "autopilot";
  if (o.source !== "workflow") return "you";
  const run = o.runId ? s.workflowRuns.find((r) => r.id === o.runId) : undefined;
  const wf = run ? s.teams.find((t) => t.id === run.teamId)?.workflow : undefined;
  const role = o.nodeId ? wf?.nodes.find((n) => n.id === o.nodeId)?.role ?? o.nodeId : undefined;
  return role ? `workflow, ${role}` : "workflow";
}

function prettySlug(slug: string): string {
  const last = slug.split("/").pop() ?? slug;
  return last.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
