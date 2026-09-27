// Global RTS keys: Ctrl/Cmd+1..9 assigns the selection to control group (team) n, 1..9 selects it,
// pressing the same digit twice quickly centres the camera on it, Esc cancels a command or clears selection.
// Note: Chrome on macOS keeps Cmd+1..8 for tab switching, so Ctrl+digit is the reliable binding there.
import type { Store } from "./store";
import type { Bus } from "./bus";
import { api } from "./api";

export function installKeys(store: Store, bus: Bus, target: Window = window): () => void {
  let lastDigit = -1;
  let lastAt = 0;

  const onKey = async (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

    if (e.key === "Escape") {
      if (bus.command) bus.setCommand(null); else bus.clear();
      return;
    }
    const m = /^Digit([1-9])$/.exec(e.code);
    if (!m) return;
    const n = Number(m[1]);

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const members = bus.selection.units.slice();
      if (!members.length) return;
      const r = await api.assignTeam(n, members);
      bus.toast(r.ok ? `Group ${n}: ${members.length} unit${members.length > 1 ? "s" : ""}` : r.error, r.ok ? "info" : "error");
      return;
    }
    if (e.altKey || e.shiftKey) return;

    const team = store.team(n);
    const members = (team?.members ?? []).filter((id) => store.unit(id));
    const now = performance.now();
    if (n === lastDigit && now - lastAt < 400 && members.length) {
      const units = members.map((id) => store.unit(id)!);
      const x = units.reduce((a, u) => a + u.pos.x, 0) / units.length;
      const y = units.reduce((a, u) => a + u.pos.y, 0) / units.length;
      bus.focusTile(Math.round(x), Math.round(y));
    }
    lastDigit = n;
    lastAt = now;
    bus.select(members);
  };

  target.addEventListener("keydown", onKey);
  return () => target.removeEventListener("keydown", onKey);
}
