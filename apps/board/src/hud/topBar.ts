// Top resource strip: numbers first with icons (labels in tooltips), New issue, control groups, backend tag.
import { api, type Bus, type Connection, type State } from "../core";
import { icon } from "../theme/icons";
import { clear, h, safeColor } from "./dom";

export class TopBar {
  private tokens = value();
  private spend = value();
  private pages = value();
  private idle = value();
  private open = value();
  private idleOf = h("span", { class: "hud-res-sub" });
  private backend = h("span", { class: "hud-conn", title: "Backend" }, "-");
  private teams = h("span", { class: "hud-teams" });
  readonly root = h("header", { class: "hud-top hud-stone" },
    h("span", { class: "hud-top-title" }, "QM Raid"),
    res("agents", "Idle agents (click to cycle)", [this.idle, this.idleOf], () => this.cycleIdle()),
    res("issues", "Open issues (click to cycle)", [this.open], () => this.cycleOpen(), "danger"),
    h("span", { class: "hud-top-sep" }),
    res("pages", "Library pages (GBrain)", [this.pages], undefined, "gold"),
    res("tokens", "Tokens used", [this.tokens]),
    res("spend", "Spend", [this.spend]),
    h("button", { class: "hud-top-btn", type: "button", title: "New issue (N)", onclick: () => this.bus.newIssue() },
      icon("spawn"), "Issue", h("span", { class: "lk-key" }, "N")),
    this.teams,
    this.backend,
  );
  private teamsSig: string | null = null;
  private last: State | null = null;
  private idleAt = -1;
  private openAt = -1;

  constructor(private bus: Bus) {}

  setState(s: State): void {
    this.tokens.textContent = compact(s.stats.tokens);
    this.spend.textContent = `$${s.stats.spentUsd.toFixed(2)}`;
    this.pages.textContent = String(s.memory.pages);
    this.idle.textContent = String(s.units.filter((u) => u.status === "idle").length);
    this.idleOf.textContent = `/${s.units.length}`;
    this.open.textContent = String(s.targets.filter((t) => t.status !== "resolved").length);
    this.backend.dataset.backend = s.backend;
    this.renderBackend(s.backend);
    this.last = s;
    this.renderTeams(s);
  }

  // Per-team autopilot toggles; rebuilt only when a team changes.
  private renderTeams(s: State): void {
    const sig = s.teams.map((t) => `${t.id}:${t.name}:${t.color}:${t.autopilot}:${t.members.length}:${t.workflow?.preset ?? ""}`).join("|");
    if (sig === this.teamsSig) return;
    this.teamsSig = sig;
    clear(this.teams);
    for (const t of s.teams) {
      const id = t.id;
      this.teams.append(h("button", {
        class: "hud-team", type: "button", "data-on": String(t.autopilot), style: `--team:${safeColor(t.color)}`,
        title: `${t.name}, group ${t.id}: ${t.members.length} units${t.workflow ? `, ${t.workflow.preset} formation` : ""}. Autopilot ${t.autopilot ? "on" : "off"} (click to toggle)`,
        onclick: () => void this.toggle(id),
      }, String(t.id), h("span", { class: "hud-team-name" }, t.name), t.workflow ? icon("formation") : null,
        t.autopilot ? h("span", { class: "hud-team-auto" }, "AUTO") : null));
    }
  }

  private async toggle(teamId: number): Promise<void> {
    const t = this.last?.teams.find((x) => x.id === teamId);
    if (!t) return;
    const r = await api.patchTeam(teamId, { autopilot: !t.autopilot });
    this.bus.toast(r.ok ? `${t.name}: autopilot ${t.autopilot ? "off" : "on"}` : r.error, r.ok ? "info" : "error");
  }

  // AoE idle-villager button: each click selects the next idle unit and centres the camera on it.
  private cycleIdle(): void {
    const idle = (this.last?.units ?? []).filter((u) => u.status === "idle");
    if (!idle.length) return this.bus.toast("No idle agents");
    const u = idle[(this.idleAt = (this.idleAt + 1) % idle.length)];
    this.bus.select([u.id]);
    this.bus.focusTile(u.pos.x, u.pos.y);
  }

  private cycleOpen(): void {
    const open = (this.last?.targets ?? []).filter((t) => t.status !== "resolved").sort((a, b) => b.severity - a.severity);
    if (!open.length) return this.bus.toast("No open issues");
    const t = open[(this.openAt = (this.openAt + 1) % open.length)];
    this.bus.selectTarget(t.id);
    this.bus.focusTile(t.pos.x, t.pos.y);
  }

  private conn: Connection = "connecting";
  private lastBackend = "";

  setConnection(c: Connection): void {
    this.conn = c;
    this.renderBackend(this.lastBackend);
  }

  private renderBackend(backend: string): void {
    this.lastBackend = backend;
    this.backend.textContent = this.conn === "live" ? backend || "live" : this.conn;
    this.backend.dataset.conn = this.conn;
    this.backend.title = `Backend: ${this.conn === "live" ? backend || "live" : this.conn}`;
  }
}

function value() {
  return h("b", { class: "hud-res-val" }, "-");
}

function res(name: string, label: string, vals: HTMLElement[], onClick?: () => void, accent?: string) {
  const kids = [h("span", { class: "hud-res-icon" }, icon(name)), ...vals];
  return onClick
    ? h("button", { class: "hud-res hud-res-btn", type: "button", title: label, "data-accent": accent, onclick: onClick }, kids)
    : h("span", { class: "hud-res", title: label, "data-accent": accent }, kids);
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
