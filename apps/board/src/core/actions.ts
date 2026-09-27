// High-level commands shared by scene/ (clicks) and hud/ (buttons), so both behave the same.
import type { Store } from "./store";
import type { Bus } from "./bus";
import { api, type Reply } from "./api";

/** A target was chosen (right-click, or left-click while a command is pending). Orders or adjusts. */
export async function commandTarget(store: Store, bus: Bus, targetId: string): Promise<Reply | null> {
  const cmd = bus.command;
  if (cmd?.kind === "adjust") {
    bus.setCommand(null);
    return report(bus, await api.adjustOrder(cmd.orderId, { targetId }), "Order adjusted");
  }
  if (cmd?.kind === "order") bus.setCommand(null);
  const unitIds = bus.selection.units.filter((id) => store.unit(id));
  if (!unitIds.length) return null;
  const t = store.target(targetId);
  return report(bus, await api.order({ unitIds, targetId }), `Ordered ${unitIds.length} to ${t?.issue ?? targetId}`);
}

/** A unit was chosen while Adjust is pending: reassign the proposed order to that unit. Returns true if consumed. */
export function commandUnit(bus: Bus, unitId: string): boolean {
  const cmd = bus.command;
  if (cmd?.kind !== "adjust") return false;
  bus.setCommand(null);
  api.adjustOrder(cmd.orderId, { unitId }).then((r) => report(bus, r, "Order adjusted"));
  return true;
}

function report(bus: Bus, r: Reply, ok: string): Reply {
  if (r.ok) bus.toast(ok);
  else bus.toast(r.error, "error");
  return r;
}

/** Keeps bus selection consistent with the store: retired units leave the selection. */
export function linkSelection(store: Store, bus: Bus): () => void {
  return store.onEvent((ev) => {
    if (ev.type !== "unit.retired") return;
    if (bus.selection.units.includes(ev.unitId)) bus.select(bus.selection.units.filter((id) => id !== ev.unitId));
  });
}
