// Bottom: minimap (left), selection identity (centre), command card (right).
import { api, commandTarget, type Bus, type State, type Store, type Unit } from "../core";
import { classIcon, icon } from "../theme/icons";
import { portraitArt } from "../theme/portrait";
import { clear, h, safeColor, safeUrl } from "./dom";
import { openFormation, teamOfSelection } from "./formation";
import { Minimap } from "./minimap";
import { BUILDINGS, className, modelLabel, portraitStyle, statusPill } from "./sidePanel";

interface Cmd { glyph: string; label: string; title: string; enabled: boolean; key?: string; armed?: boolean; run?: () => void }

// Keys the camera, core (groups, Esc), scene and New issue (N) already use.
const RESERVED = new Set(["w", "a", "s", "d", "h", "n", " ", "escape", ..."0123456789"]);

const SLOTS = 6;
const CONFIRM_MS = 3000;
const HINT_KEY = "raid.hint.v1";
const HINT_MS = 6000;

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
    window.addEventListener("keydown", this.onKey);
    this.root = h("footer", { class: "hud-bottom" }, this.minimap.root, this.summary, this.grid, firstHint());
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
  }

  // Grid hotkeys: the letter shown on each button, resolved against the current selection.
  private onKey = (e: KeyboardEvent): void => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    if (RESERVED.has(key)) return;
    const cmd = this.commands(this.store.getState()).find((c) => c.key === key);
    if (!cmd) return;
    e.preventDefault(); // also keeps the letter out of a box the command focuses (Message)
    if (cmd.enabled) cmd.run?.();
  };

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
    const sig = cmds.map((c) => `${c.label}:${c.enabled}:${c.key ?? ""}`).join("|");
    if (sig === this.gridSig) return;
    this.gridSig = sig;
    clear(this.grid);
    for (let i = 0; i < SLOTS; i++) {
      const c = cmds[i];
      this.grid.append(c
        ? h("button", { class: "hud-cmd", type: "button", title: c.key ? `${c.title} (${c.key.toUpperCase()})` : c.title, disabled: !c.enabled,
            "data-armed": c.armed ? "true" : null, onclick: () => this.runSlot(i) },
            h("span", { class: "hud-cmd-glyph" }, icon(c.glyph)), h("span", { class: "hud-cmd-label" }, c.label),
            c.key ? h("span", { class: "hud-cmd-key" }, c.key.toUpperCase()) : null)
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
        { glyph: "order", label: "Attack", key: "f", title: units.length ? `Send ${units.length} selected` : "Attack: select units first",
          enabled: !!t && t.status !== "resolved" && units.length > 0, run: () => void commandTarget(this.store, this.bus, targetId) },
        { glyph: "focus", label: "Focus", key: "v", title: "Centre camera", enabled: !!t, run: () => t && this.bus.focusTile(t.pos.x, t.pos.y) },
      ];
    }
    if (sel.focus === "building" && sel.building) {
      const b = s.buildings.find((x) => x.id === sel.building);
      const focus: Cmd = { glyph: "focus", label: "Focus", key: "v", title: "Centre camera", enabled: !!b, run: () => b && this.bus.focusTile(b.x, b.y) };
      if (b?.kind === "barracks") {
        const builtin = s.unitTypes.filter((t) => t.source === "builtin").slice(0, SLOTS - 1);
        const types = builtin.length ? builtin.map((t) => [t.id, t.name] as const) : ([["knight", "Knight"], ["ranger", "Ranger"], ["scout", "Scout"]] as const);
        const used = new Set(["v"]);
        return [...types.map(([id, name]) => this.train(id, name, classIcon(id), freeKey(name, used))), focus];
      }
      return [focus];
    }
    if (!units.length) return [];
    const one = units.length === 1 ? units[0] : null;
    const qm = one ? safeUrl(one.qm?.sessionUrl) : null;
    const confirming = !!one && this.confirmRetire === one.id;
    const order: Cmd = { glyph: "order", label: "Order", key: "o", title: "Order: pick a camp (or right-click one)", enabled: true,
      run: () => this.bus.setCommand({ kind: "order" }) };
    const recall: Cmd = { glyph: "recall", label: "Recall", key: "r", title: "Recall from the Library (GBrain)", enabled: true,
      run: () => this.ask(units, recallText(s), "Recall") };
    const remember: Cmd = { glyph: "remember", label: "Remember", key: "b", title: "Remember a learning in the Library (GBrain)", enabled: true,
      run: () => this.ask(units, REMEMBER_TEXT, "Remember") };
    if (!one) {
      return [order,
        { glyph: "formation", label: "Formation", key: "f", title: "Formation: make a team and set its roles", enabled: true,
          run: () => void openFormation(this.store, this.bus, units.map((u) => u.id)) },
        recall, remember];
    }
    return [
      order,
      { glyph: "message", label: "Message", key: "m", title: "Message", enabled: true, run: this.focusMessage },
      recall,
      remember,
      { glyph: "open", label: "Open", key: "q", title: qm ? "Open the QM session" : "No QM session yet", enabled: !!qm,
        run: () => qm && window.open(qm, "_blank", "noopener,noreferrer") },
      { glyph: "retire", label: confirming ? "Confirm" : "Retire", key: "x", armed: confirming,
        title: confirming ? "Click again to retire" : "Retire (click twice)", enabled: true, run: () => this.retire(one) },
    ];
  }

  private train(cls: string, label: string, glyph: string, key?: string): Cmd {
    return {
      glyph, key, label, title: `Train ${label}`, enabled: true,
      run: async () => {
        const r = await api.spawn({ class: cls });
        this.bus.toast(r.ok ? `${label} trained` : r.error, r.ok ? "info" : "error");
      },
    };
  }

  private async ask(units: Unit[], text: (u: Unit) => string, what: string): Promise<void> {
    const results = await Promise.all(units.map((u) => api.message(u.id, text(u))));
    const failed = results.find((r): r is { ok: false; error: string } => !r.ok);
    this.bus.toast(failed ? `${what}: ${failed.error}` : `${what}: ${units.length === 1 ? units[0].name : `${units.length} agents`}`, failed ? "error" : "info");
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
    let node: HTMLElement | null = null;
    let sig: string;
    if (sel.focus === "target" && sel.target) {
      const t = s.targets.find((x) => x.id === sel.target);
      const comp = t ? s.components.find((c) => c.id === t.component) : undefined;
      sig = t ? `t:${t.id}:${t.status}:${t.title}:${t.severity}` : "none";
      node = t
        ? h("div", { class: "hud-sum-one" },
            h("div", { class: "hud-portrait hud-portrait-lg hud-portrait-foe" }, icon(t.kind === "bug" ? "bug" : "camp")),
            h("div", { class: "hud-sum-info" },
              h("div", { class: "hud-sum-name", title: t.title }, t.title),
              h("div", { class: "hud-sum-row" },
                h("span", { class: "hud-tag hud-tag-id" }, t.issue),
                h("span", { class: "hud-tag" }, t.kind),
                comp ? h("span", { class: "hud-tag" }, comp.name) : null,
                severity(t.severity),
                h("span", { class: `hud-pill hud-target-${t.status}` }, t.status))))
        : null;
    } else if (sel.focus === "building" && sel.building) {
      const b = s.buildings.find((x) => x.id === sel.building);
      const info = b ? BUILDINGS[b.kind] : undefined;
      sig = b ? `b:${b.id}:${s.memory.pages}:${s.units.length}` : "none";
      // Library and Forge open a full overlay with their own header: no second identity here.
      node = b && info && b.kind !== "gbrain" && b.kind !== "river"
        ? h("div", { class: "hud-sum-one" },
            h("div", { class: "hud-portrait hud-portrait-lg hud-portrait-building", "data-kind": b.kind }, icon(info.icon)),
            h("div", { class: "hud-sum-info" },
              h("div", { class: "hud-sum-name" }, info.name),
              h("div", { class: "hud-sum-row" },
                info.mark ? h("span", { class: "hud-tag" }, info.mark) : null,
                b.kind === "barracks" ? h("span", { class: "hud-sum-sub" }, `${s.units.length} agents`) : null)))
        : null;
    } else if (units.length === 1) {
      const u = units[0];
      const team = s.teams.find((t) => t.id === u.team);
      const order = u.orderId ? s.orders.find((o) => o.id === u.orderId) : undefined;
      const target = order ? s.targets.find((t) => t.id === order.targetId) : undefined;
      sig = `u:${u.id}:${u.name}:${u.status}:${u.model}:${u.effort}:${team?.color}:${team?.name}:${target?.id}:${order?.status}:${s.unitTypes.length}`;
      const cn = className(s, u.class);
      const model = modelLabel(u.model);
      node = h("div", { class: "hud-sum-one" },
        h("div", { class: "hud-portrait hud-portrait-lg", style: portraitStyle(u.class, team?.color) }, portraitArt(u.class, team?.color, 104)),
        h("div", { class: "hud-sum-info" },
          h("div", { class: "hud-sum-name" }, u.name),
          h("div", { class: "hud-sum-row" },
            h("span", { class: "hud-tag", title: cn.forged ? u.class : null }, cn.name),
            cn.forged ? h("span", { class: "hud-tag hud-tag-river" }, "River") : null,
            team ? h("span", { class: "hud-tag", style: `--team:${safeColor(team.color)}` }, team.name) : null,
            statusPill(u.status),
            h("span", { class: "hud-sum-sub hud-dim", title: u.model ?? "" }, model ? `${model} ${u.effort}` : u.effort)),
          target
            ? h("div", { class: "hud-sum-order" },
                h("div", { class: "hud-sum-sub" }, h("span", { class: "hud-tag hud-tag-id" }, target.issue), " ", target.title),
                h("div", { class: "hud-bar", "data-busy": u.status === "working" || u.status === "recalling" || u.status === "remembering" ? "true" : null,
                  style: `--p:${order?.status === "done" ? 100 : 0}%` }, h("i")))
            : h("div", { class: "hud-sum-sub hud-dim" }, "No order")));
    } else if (units.length > 1) {
      const group = teamOfSelection(s, units.map((u) => u.id));
      const busy = units.filter((u) => u.status !== "idle").length;
      sig = "m:" + units.map((u) => `${u.id}:${u.status}:${u.team}`).join(",") + `:${group?.id}:${group?.name}:${group?.workflow?.preset}:${group?.autopilot}`;
      node = h("div", { class: "hud-sum-group" },
        h("div", { class: "hud-sum-info" },
          h("div", { class: "hud-sum-name", style: group ? `color:${safeColor(group.color)}` : null }, group ? group.name : `${units.length} selected`),
          h("div", { class: "hud-sum-row" },
            group ? h("span", { class: "hud-tag" }, `Group ${group.id}`) : null,
            h("span", { class: "hud-tag" }, `${units.length} units`),
            group?.workflow ? h("span", { class: "hud-tag" }, icon("formation"), group.workflow.preset) : null,
            group?.autopilot ? h("span", { class: "hud-tag", style: "color:var(--gold)" }, "Auto") : null),
          h("div", { class: "hud-sum-row" },
            h("span", { class: "hud-pill hud-st-working" }, `${busy} busy`),
            h("span", { class: "hud-pill hud-st-idle" }, `${units.length - busy} idle`))),
        h("div", { class: "hud-sum-many" }, units.slice(0, 12).map((u) => {
          const team = s.teams.find((t) => t.id === u.team);
          return h("button", { class: "hud-portrait hud-portrait-md", type: "button", title: `${u.name}, ${u.status.replace("_", " ")}`, "data-status": u.status,
            style: portraitStyle(u.class, team?.color), onclick: () => this.bus.select([u.id]) }, portraitArt(u.class, team?.color, 44));
        })));
    } else {
      sig = "none";
    }
    if (sig === this.summarySig) return;
    this.summarySig = sig;
    clear(this.summary);
    this.summary.dataset.empty = node ? "false" : "true";
    if (node) this.summary.append(node);
  }
}

function severity(n: number): HTMLElement {
  return h("span", { class: "hud-sev", title: `Severity ${n} of 3` }, [1, 2, 3].map((i) => h("i", { "data-on": i <= n ? "true" : null })));
}

// One-time hint strip over the bottom panel; fades after a few seconds and never shows again.
function firstHint(): HTMLElement | null {
  try {
    if (localStorage.getItem(HINT_KEY)) return null;
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    return null;
  }
  const el = h("div", { class: "hud-firsthint" },
    h("span", null, icon("mouse"), h("b", null, "Click"), "select"),
    h("span", null, h("b", null, "Drag"), "box"),
    h("span", null, h("b", null, "Right-click"), "order"),
    h("span", null, h("span", { class: "lk-key" }, "Ctrl"), h("span", { class: "lk-key" }, "1-9"), "group"));
  setTimeout(() => { el.dataset.leaving = "true"; setTimeout(() => el.remove(), 700); }, HINT_MS);
  return el;
}

/** First letter of name that is neither reserved nor used yet (marks it used). */
function freeKey(name: string, used: Set<string>): string | undefined {
  for (const ch of name.toLowerCase()) {
    if (ch >= "a" && ch <= "z" && !RESERVED.has(ch) && !used.has(ch)) { used.add(ch); return ch; }
  }
  return undefined;
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
