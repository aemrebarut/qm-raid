// Top resource bar in the AoE style: tokens, spend, Library pages, idle agents, open issues, backend.
import { api, type Bus, type Connection, type State } from "../core";
import { clear, h, safeColor } from "./dom";

export class TopBar {
  private tokens = value();
  private spend = value();
  private pages = value();
  private idle = value();
  private open = value();
  private backend = value();
  private teams = h("span", { class: "hud-teams" });
  readonly root = h("header", { class: "hud-top hud-stone" },
    h("span", { class: "hud-top-title" }, "QM Raid"),
    res("\u{1FA99}", "Tokens", this.tokens),
    res("\u{1F4B0}", "Spend", this.spend),
    res("\u{1F4DA}", "Library pages", this.pages),
    res("\u{1F9CD}", "Idle agents", this.idle),
    res("\u{1F47E}", "Open issues", this.open),
    res("\u{1F310}", "Backend", this.backend),
    this.teams,
  );
  private teamsSig: string | null = null;
  private last: State | null = null;

  constructor(private bus: Bus) {}

  setState(s: State): void {
    this.tokens.textContent = compact(s.stats.tokens);
    this.spend.textContent = `$${s.stats.spentUsd.toFixed(2)}`;
    this.pages.textContent = String(s.memory.pages);
    this.idle.textContent = `${s.units.filter((u) => u.status === "idle").length} / ${s.units.length}`;
    this.open.textContent = String(s.targets.filter((t) => t.status !== "resolved").length);
    this.backend.dataset.backend = s.backend;
    this.renderBackend(s.backend);
    this.last = s;
    this.renderTeams(s);
  }

  // Per-team autopilot toggles; rebuilt only when a team changes.
  private renderTeams(s: State): void {
    const sig = s.teams.map((t) => `${t.id}:${t.name}:${t.color}:${t.autopilot}:${t.members.length}`).join("|");
    if (sig === this.teamsSig) return;
    this.teamsSig = sig;
    clear(this.teams);
    for (const t of s.teams) {
      const id = t.id;
      this.teams.append(h("button", {
        class: "hud-team", type: "button", "data-on": String(t.autopilot), style: `--team:${safeColor(t.color)}`,
        title: `${t.name} (group ${t.id}, ${t.members.length} units): autopilot ${t.autopilot ? "on" : "off"}. Click to toggle.`,
        onclick: () => void this.toggle(id),
      }, h("span", { class: "hud-team-dot" }), String(t.id), h("span", { class: "hud-team-name" }, t.name), h("span", { class: "hud-team-auto" }, t.autopilot ? "AUTO" : "manual")));
    }
  }

  private async toggle(teamId: number): Promise<void> {
    const t = this.last?.teams.find((x) => x.id === teamId);
    if (!t) return;
    const r = await api.patchTeam(teamId, { autopilot: !t.autopilot });
    this.bus.toast(r.ok ? `${t.name}: autopilot ${t.autopilot ? "off" : "on"}` : r.error, r.ok ? "info" : "error");
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
  }
}

function value() {
  return h("b", { class: "hud-res-val" }, "-");
}

function res(icon: string, label: string, val: HTMLElement) {
  return h("span", { class: "hud-res", title: label }, h("span", { class: "hud-res-icon" }, icon), val);
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
