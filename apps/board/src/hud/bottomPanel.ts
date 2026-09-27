// AoE bottom panel: command grid (left), selection summary (middle), minimap (right).
import { api, commandTarget, type Bus, type State, type Store, type Unit } from "../core";
import { clear, h, safeColor, safeUrl } from "./dom";
import { Minimap } from "./minimap";
import { BUILDINGS, classGlyph, statusPill } from "./sidePanel";

interface Cmd { glyph: string; label: string; title: string; enabled: boolean; run?: () => void }

const SLOTS = 6;
const CONFIRM_MS = 3000;

export class BottomPanel {
  private grid = h("div", { class: "hud-cmds" });
  private summary = h("div", { class: "hud-summary" });
  private minimap: Minimap;
  readonly root: HTMLElement;
  private gridSig: string | null = null;
  private summarySig: string | null = null;
  private confirmRetire: string | null = null; // unit id awaiting a second click

  constructor(private store: Store, private bus: Bus, private focusMessage: () => void) {
    this.minimap = new Minimap(bus);
    this.root = h("footer", { class: "hud-bottom hud-stone" }, this.grid, this.summary, this.minimap.root);
  }

  setState(s: State): void {
    this.renderGrid(s);
    this.renderSummary(s);
    this.minimap.draw(s);
  }

  private selectedUnits(s: State): Unit[] {
    return this.bus.selection.units.map((id) => s.units.find((u) => u.id === id)).filter((u): u is Unit => !!u);
  }

  // Rebuilt only when labels or enabled states change, so clicks are not lost to re-renders.
  private renderGrid(s: State): void {
    const cmds = this.commands(s);
    const sig = cmds.map((c) => `${c.label}:${c.enabled}`).join("|");
    if (sig === this.gridSig) return;
    this.gridSig = sig;
    clear(this.grid);
    for (let i = 0; i < SLOTS; i++) {
      const c = cmds[i];
      this.grid.append(c
        ? h("button", { class: "hud-cmd", type: "button", title: c.title, disabled: !c.enabled, onclick: () => this.runSlot(i) },
            h("span", { class: "hud-cmd-glyph" }, c.glyph), h("span", { class: "hud-cmd-label" }, c.label))
        : h("div", { class: "hud-cmd hud-cmd-empty" }));
    }
  }

  // Resolve the command at click time so it acts on the current selection, not the one at render.
  private runSlot(i: number): void {
    const c = this.commands(this.store.getState())[i];
    if (c?.enabled) c.run?.();
  }

  private commands(s: State): Cmd[] {
    const sel = this.bus.selection;
    const units = this.selectedUnits(s);
    if (sel.focus === "target" && sel.target) {
      const t = s.targets.find((x) => x.id === sel.target);
      const targetId = sel.target;
      return [
        { glyph: "⚔", label: "Attack", title: units.length ? `Send ${units.length} selected unit(s) to this camp` : "Select units first",
          enabled: !!t && t.status !== "resolved" && units.length > 0, run: () => void commandTarget(this.store, this.bus, targetId) },
        { glyph: "\u{1F441}", label: "Focus", title: "Centre the camera here", enabled: !!t, run: () => t && this.bus.focusTile(t.pos.x, t.pos.y) },
      ];
    }
    if (sel.focus === "building" && sel.building) {
      const b = s.buildings.find((x) => x.id === sel.building);
      const focus: Cmd = { glyph: "\u{1F441}", label: "Focus", title: "Centre the camera here", enabled: !!b, run: () => b && this.bus.focusTile(b.x, b.y) };
      if (b?.kind === "barracks") {
        return [
          this.train("knight", "Knight", "♞"),
          this.train("ranger", "Ranger", "\u{1F3F9}"),
          this.train("scout", "Scout", "\u{1F9ED}"),
          focus,
        ];
      }
      return [focus];
    }
    if (!units.length) return [];
    const one = units.length === 1 ? units[0] : null;
    const qm = one ? safeUrl(one.qm?.sessionUrl) : null;
    const confirming = !!one && this.confirmRetire === one.id;
    return [
      { glyph: "⚔", label: "Order", title: "Choose a camp for the selected units (or right-click one)", enabled: true,
        run: () => this.bus.setCommand({ kind: "order" }) },
      { glyph: "✉", label: "Message", title: one ? "Write to this agent" : "Select one unit", enabled: !!one, run: this.focusMessage },
      { glyph: "\u{1F4D6}", label: "Recall", title: "Ask the agent(s) to recall from the Library (GBrain)", enabled: true,
        run: () => this.ask(units, recallText(s), "Recall") },
      { glyph: "\u{1F4DC}", label: "Remember", title: "Ask the agent(s) to write a learning to the Library (GBrain)", enabled: true,
        run: () => this.ask(units, REMEMBER_TEXT, "Remember") },
      { glyph: "\u{1F517}", label: "Open in QM", title: qm ? "Open this agent's QM session" : "No QM session yet", enabled: !!qm,
        run: () => qm && window.open(qm, "_blank", "noopener,noreferrer") },
      { glyph: confirming ? "❗" : "\u{1FAA6}", label: confirming ? "Sure?" : "Retire",
        title: one ? "Retire this agent (click twice)" : "Select one unit",
        enabled: !!one, run: () => one && this.retire(one) },
    ];
  }

  private train(cls: string, label: string, glyph: string): Cmd {
    return {
      glyph, label: `Train ${label}`, title: `Train a new ${label.toLowerCase()} at the Barracks`, enabled: true,
      run: async () => {
        const r = await api.spawn({ class: cls });
        this.bus.toast(r.ok ? `${label} trained` : r.error, r.ok ? "info" : "error");
      },
    };
  }

  private async ask(units: Unit[], text: (u: Unit) => string, what: string): Promise<void> {
    const results = await Promise.all(units.map((u) => api.message(u.id, text(u))));
    const failed = results.find((r): r is { ok: false; error: string } => !r.ok);
    this.bus.toast(failed ? `${what}: ${failed.error}` : `${what}: asked ${units.length} agent${units.length > 1 ? "s" : ""}`, failed ? "error" : "info");
  }

  private async retire(u: Unit): Promise<void> {
    if (this.confirmRetire !== u.id) {
      this.confirmRetire = u.id;
      this.renderGrid(this.store.getState());
      setTimeout(() => {
        if (this.confirmRetire !== u.id) return;
        this.confirmRetire = null;
        this.renderGrid(this.store.getState());
      }, CONFIRM_MS);
      return;
    }
    this.confirmRetire = null;
    const r = await api.retire(u.id);
    this.bus.toast(r.ok ? `${u.name} retired` : r.error, r.ok ? "info" : "error");
    this.renderGrid(this.store.getState());
  }

  private renderSummary(s: State): void {
    const sel = this.bus.selection;
    const units = this.selectedUnits(s);
    let node: HTMLElement;
    let sig: string;
    if (sel.focus === "target" && sel.target) {
      const t = s.targets.find((x) => x.id === sel.target);
      sig = t ? `t:${t.id}:${t.status}:${t.title}` : "none";
      node = t
        ? h("div", { class: "hud-sum-one" },
            h("div", { class: "hud-portrait hud-portrait-lg hud-portrait-foe" }, t.kind === "bug" ? "\u{1F47E}" : "\u{1F3F0}"),
            h("div", null, h("div", { class: "hud-sum-name" }, t.title), h("div", { class: "hud-sum-sub" }, `${t.issue} · ${t.kind} · severity ${t.severity}`),
              h("span", { class: `hud-pill hud-target-${t.status}` }, t.status)))
        : empty();
    } else if (sel.focus === "building" && sel.building) {
      const b = s.buildings.find((x) => x.id === sel.building);
      const info = b ? BUILDINGS[b.kind] : undefined;
      sig = b ? `b:${b.id}:${s.memory.pages}` : "none";
      node = b && info
        ? h("div", { class: "hud-sum-one" },
            h("div", { class: "hud-portrait hud-portrait-lg hud-portrait-building" }, info.glyph),
            h("div", null, h("div", { class: "hud-sum-name" }, info.name), h("div", { class: "hud-sum-sub" }, info.blurb),
              b.kind === "gbrain" ? h("div", { class: "hud-sum-sub" }, `${s.memory.pages} pages`) : null))
        : empty();
    } else if (units.length === 1) {
      const u = units[0];
      const team = s.teams.find((t) => t.id === u.team);
      const order = u.orderId ? s.orders.find((o) => o.id === u.orderId) : undefined;
      const target = order ? s.targets.find((t) => t.id === order.targetId) : undefined;
      sig = `u:${u.id}:${u.status}:${u.model}:${u.effort}:${team?.color}:${target?.id}`;
      node = h("div", { class: "hud-sum-one" },
        h("div", { class: "hud-portrait hud-portrait-lg", style: `--team:${safeColor(team?.color)}` }, classGlyph(u.class)),
        h("div", null,
          h("div", { class: "hud-sum-name" }, u.name),
          h("div", { class: "hud-sum-sub" }, `${u.class}${team ? ` · ${team.name}` : ""} · ${u.model} (${u.effort})`),
          statusPill(u.status),
          h("div", { class: "hud-sum-sub" }, target ? `⚔ ${target.issue}: ${target.title}` : "No order")));
    } else if (units.length > 1) {
      sig = "m:" + units.map((u) => `${u.id}:${u.status}:${u.team}`).join(",");
      node = h("div", { class: "hud-sum-many" }, units.slice(0, 18).map((u) => {
        const team = s.teams.find((t) => t.id === u.team);
        return h("button", { class: "hud-portrait hud-portrait-md", type: "button", title: `${u.name} (${u.status})`, "data-status": u.status,
          style: `--team:${safeColor(team?.color)}`, onclick: () => this.bus.select([u.id]) }, classGlyph(u.class));
      }));
    } else {
      sig = "none";
      node = empty();
    }
    if (sig === this.summarySig) return;
    this.summarySig = sig;
    clear(this.summary);
    this.summary.append(node);
  }
}

function empty(): HTMLElement {
  return h("div", { class: "hud-sum-empty" },
    h("div", null, "Click a unit to select it, drag to select many."),
    h("div", null, "Right-click an enemy camp to send them. Ctrl+1..9 makes a group."));
}

function recallText(s: State): (u: Unit) => string {
  return (u) => {
    const order = u.orderId ? s.orders.find((o) => o.id === u.orderId) : undefined;
    const t = order ? s.targets.find((x) => x.id === order.targetId) : undefined;
    const about = t ? `${t.issue} "${t.title}" in component ${t.component}` : "your current work";
    return `Use your GBrain tools now to recall what the team already knows about ${about} (rules, past learnings, affected customers). Reply with the key points in two lines.`;
  };
}

const REMEMBER_TEXT = () =>
  "Use your GBrain tools now to remember the most useful learning from your current work as a GBrain page, linked to the issue and component. Reply with the page slug.";
