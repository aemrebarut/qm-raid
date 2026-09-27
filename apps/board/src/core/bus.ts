// Tiny UI event bus for selection and hover, shared by scene/ and hud/.
// Selection is one object; focus says which panel the HUD should show.

export type HoverRef = { kind: "unit" | "target" | "building" | "tile"; id: string } | null;

export interface Selection {
  units: string[];
  target: string | null;
  building: string | null;
  focus: "units" | "target" | "building" | null;
}

export type BusEvents = {
  select: string[];                 // selected unit ids (empty = none)
  selectTarget: string | null;
  selectBuilding: string | null;
  selection: Selection;             // fired after any of the three above
  hover: HoverRef;
  focusTile: { x: number; y: number }; // ask the camera to centre on a tile (minimap clicks)
};

type Handler<T> = (payload: T) => void;

export interface Bus {
  readonly selection: Selection;
  readonly hovered: HoverRef;
  select(unitIds: string[], opts?: { add?: boolean }): void;
  selectTarget(id: string | null): void;
  selectBuilding(id: string | null): void;
  clear(): void;
  hover(ref: HoverRef): void;
  focusTile(x: number, y: number): void;
  on<K extends keyof BusEvents>(type: K, fn: Handler<BusEvents[K]>): () => void;
  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]): void;
}

export function createBus(): Bus {
  const handlers = new Map<keyof BusEvents, Set<Handler<any>>>();
  let selection: Selection = { units: [], target: null, building: null, focus: null };
  let hovered: HoverRef = null;

  const emit = <K extends keyof BusEvents>(type: K, payload: BusEvents[K]) => {
    for (const fn of handlers.get(type) ?? []) {
      try { fn(payload); } catch (err) { console.error(`[bus] ${String(type)} handler failed`, err); }
    }
  };
  const changed = () => emit("selection", selection);

  return {
    get selection() { return selection; },
    get hovered() { return hovered; },
    select(unitIds, opts) {
      const units = opts?.add ? [...new Set([...selection.units, ...unitIds])] : [...unitIds];
      // Selecting units keeps a selected target (so "units then target" can order), drops the building.
      selection = { units, target: selection.target, building: null, focus: units.length ? "units" : null };
      emit("select", units);
      changed();
    },
    selectTarget(id) {
      selection = { ...selection, target: id, building: null, focus: id ? "target" : (selection.units.length ? "units" : null) };
      emit("selectTarget", id);
      changed();
    },
    selectBuilding(id) {
      selection = { units: [], target: null, building: id, focus: id ? "building" : null };
      emit("selectBuilding", id);
      changed();
    },
    clear() {
      selection = { units: [], target: null, building: null, focus: null };
      emit("select", []);
      emit("selectTarget", null);
      emit("selectBuilding", null);
      changed();
    },
    hover(ref) {
      hovered = ref;
      emit("hover", ref);
    },
    focusTile(x, y) { emit("focusTile", { x, y }); },
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
      return () => { handlers.get(type)!.delete(fn); };
    },
    emit,
  };
}
