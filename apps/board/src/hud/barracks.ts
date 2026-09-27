// Barracks (side panel section): train a unit of each built-in class, optionally into a team.
// Persistent across renders; rows rebuild only when types, counts or teams change.
import { api, type Bus, type State, type UnitType } from "../core";
import { portraitArt } from "../theme/portrait";
import { clear, h } from "./dom";

// Contract class map (effort is not on UnitType).
const EFFORT: Record<string, string> = { knight: "high", ranger: "medium", scout: "low" };
const FALLBACK: UnitType[] = ["knight", "ranger", "scout"].map((id) => ({
  id, name: id[0].toUpperCase() + id.slice(1), source: "builtin", status: "ready", progress: 1, stage: "ready", model: null,
}));

export class BarracksPanel {
  private rows = h("ul", { class: "hud-train" });
  private team = h("select", { class: "hud-select", title: "Team for new units" });
  readonly root = h("section", { class: "hud-section", hidden: true },
    h("h3", null, "Train"),
    h("label", { class: "hud-sub hud-train-team" }, "Team", this.team),
    this.rows);
  private rowsSig: string | null = null;
  private teamsSig: string | null = null;

  constructor(private bus: Bus) {}

  setState(s: State): void {
    const types = s.unitTypes.filter((t) => t.source === "builtin");
    const list = types.length ? types : FALLBACK;
    const count = (cls: string) => s.units.filter((u) => u.class === cls).length;

    const teamsSig = s.teams.map((t) => `${t.id}:${t.name}`).join("|");
    if (teamsSig !== this.teamsSig) {
      this.teamsSig = teamsSig;
      const keep = this.team.value;
      clear(this.team);
      this.team.append(h("option", { value: "" }, "No team"), ...s.teams.map((t) => h("option", { value: String(t.id) }, `${t.id} ${t.name}`)));
      this.team.value = [...this.team.options].some((o) => o.value === keep) ? keep : "";
    }

    const sig = list.map((t) => `${t.id}:${t.name}:${t.model}:${t.status}:${count(t.id)}`).join("|");
    if (sig === this.rowsSig) return;
    this.rowsSig = sig;
    clear(this.rows);
    for (const t of list) {
      const id = t.id;
      const name = t.name;
      this.rows.append(h("li", { class: "hud-train-row" },
        h("span", { class: "hud-portrait hud-portrait-sm" }, portraitArt(id, null, 28)),
        h("span", { class: "hud-train-info" },
          h("b", null, name),
          h("span", { class: "hud-sub" }, `${t.model ?? "class model"}${EFFORT[id] ? ` ${EFFORT[id]}` : ""}`)),
        h("span", { class: "hud-count", title: "In the field" }, String(count(id))),
        h("button", { class: "hud-btn hud-btn-sm", type: "button", disabled: t.status !== "ready", onclick: () => void this.train(id, name) }, "Train"),
      ));
    }
  }

  private async train(cls: string, name: string): Promise<void> {
    const team = this.team.value ? Number(this.team.value) : undefined;
    const r = await api.spawn(team === undefined ? { class: cls } : { class: cls, team });
    this.bus.toast(r.ok ? `${name} trained${team !== undefined ? ` for team ${team}` : ""}` : r.error, r.ok ? "info" : "error");
  }
}
