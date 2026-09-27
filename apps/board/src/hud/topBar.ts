// Top resource bar in the AoE style: tokens, spend, Library pages, idle agents, open issues, backend.
import type { Connection, State } from "../core";
import { h } from "./dom";

export class TopBar {
  private tokens = value();
  private spend = value();
  private pages = value();
  private idle = value();
  private open = value();
  private backend = value();
  readonly root = h("header", { class: "hud-top hud-stone" },
    h("span", { class: "hud-top-title" }, "QM Raid"),
    res("\u{1FA99}", "Tokens", this.tokens),
    res("\u{1F4B0}", "Spend", this.spend),
    res("\u{1F4DA}", "Library pages", this.pages),
    res("\u{1F9CD}", "Idle agents", this.idle),
    res("\u{1F47E}", "Open issues", this.open),
    res("\u{1F310}", "Backend", this.backend),
  );

  setState(s: State): void {
    this.tokens.textContent = compact(s.stats.tokens);
    this.spend.textContent = `$${s.stats.spentUsd.toFixed(2)}`;
    this.pages.textContent = String(s.memory.pages);
    this.idle.textContent = `${s.units.filter((u) => u.status === "idle").length} / ${s.units.length}`;
    this.open.textContent = String(s.targets.filter((t) => t.status !== "resolved").length);
    this.backend.dataset.backend = s.backend;
    this.renderBackend(s.backend);
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
