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
  if (cmd?.kind === "role") { bus.setCommand(null); return null; } // a role takes a unit, not a camp
  if (cmd?.kind === "order") bus.setCommand(null);
  const unitIds = bus.selection.units.filter((id) => store.unit(id));
  if (!unitIds.length) return null;
  const t = store.target(targetId);
  // A whole team with a workflow is ordered as the team, so the engine starts a workflow run.
  const team = workflowTeam(store, unitIds);
  if (team) {
    return report(bus, await api.order({ teamId: team.id, targetId }), `${team.name} (${team.workflow!.preset}) takes ${t?.issue ?? targetId}`);
  }
  return report(bus, await api.order({ unitIds, targetId }), `Ordered ${unitIds.length} to ${t?.issue ?? targetId}`);
}

/** The team whose members are exactly these units, if it has a workflow. */
export function workflowTeam(store: Store, unitIds: string[]) {
  const ids = new Set(unitIds);
  return store.getState().teams.find(
    (tm) => tm.workflow && tm.members.length === ids.size && tm.members.every((m) => ids.has(m)),
  );
}

/** A unit was chosen while Adjust or Role is pending: reassign the proposed order, or give the unit the role. Returns true if consumed. */
export function commandUnit(bus: Bus, unitId: string, store: Store | null = linked): boolean {
  const cmd = bus.command;
  if (cmd?.kind === "role" && store) {
    bus.setCommand(null);
    void assignRole(store, bus, cmd.teamId, cmd.nodeId, unitId);
    return true;
  }
  if (cmd?.kind !== "adjust") return false;
  bus.setCommand(null);
  api.adjustOrder(cmd.orderId, { unitId }).then((r) => report(bus, r, "Order adjusted"));
  return true;
}

/**
 * Formation: makes the units a team (the team they already form exactly, else the lowest free group 1..9),
 * then selects them so the HUD shows the team view. Resolves the team id, or null.
 */
export async function formTeam(store: Store, bus: Bus, unitIds = bus.selection.units): Promise<number | null> {
  const ids = unitIds.filter((id) => store.unit(id));
  if (!ids.length) return null;
  const teams = store.getState().teams;
  const same = teams.find((tm) => tm.members.length === ids.length && ids.every((id) => tm.members.includes(id)));
  if (same) { bus.select(ids); return same.id; }
  let id = 0;
  for (let n = 1; n <= 9 && !id; n++) if (!teams.some((tm) => tm.id === n && tm.members.length)) id = n;
  if (!id) { bus.toast("All nine groups are in use", "error"); return null; }
  const r = await api.assignTeam(id, ids);
  if (!r.ok) { bus.toast(r.error, "error"); return null; }
  bus.select(ids);
  return id;
}

/**
 * Gives a unit a role (workflow node) in a team. A unit from outside joins the team first; a member
 * that already holds another role swaps with the node's current unit.
 */
export async function assignRole(store: Store, bus: Bus, teamId: number, nodeId: string, unitId: string): Promise<Reply | null> {
  const team = store.team(teamId);
  const wf = team?.workflow;
  const node = wf?.nodes.find((n) => n.id === nodeId);
  const unit = store.unit(unitId);
  if (!team || !wf || !node || !unit) { bus.toast("That role is gone", "error"); return null; }
  const prev = node.unitId;
  const workflow = structuredClone(wf);
  for (const n of workflow.nodes) {
    if (n.id === nodeId) n.unitId = unitId;
    else if (n.unitId === unitId) n.unitId = prev;
  }
  if (!team.members.includes(unitId)) {
    const joined = await api.assignTeam(teamId, [...team.members, unitId]);
    if (!joined.ok) return report(bus, joined, "");
  }
  return report(bus, await api.setWorkflow(teamId, { workflow }), `${unit.name} is ${node.role}`);
}

function report(bus: Bus, r: Reply, ok: string): Reply {
  if (r.ok) bus.toast(ok);
  else bus.toast(r.error, "error");
  return r;
}

// The app store, for commands completed by a click that carries no store (commandUnit from the scene).
let linked: Store | null = null;

/** Keeps bus selection consistent with the store: retired units leave the selection. Also links the store for commandUnit. */
export function linkSelection(store: Store, bus: Bus): () => void {
  linked = store;
  return store.onEvent((ev) => {
    if (ev.type !== "unit.retired") return;
    if (bus.selection.units.includes(ev.unitId)) bus.select(bus.selection.units.filter((id) => id !== ev.unitId));
  });
}
