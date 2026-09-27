// In-memory game state plus the SSE event fan-out.
import type { EngineEvent, EngineEventType, State } from "../../../contract/types.ts";
import { fixtureState } from "./fixture.ts";

export const store: { state: State } = { state: fixtureState() };

type Listener = (chunk: string) => void;
const listeners = new Set<Listener>();
let seq = 0;
// Last events, for debugging (GET /api/debug/events).
const recent: string[] = [];
export const recentEvents = () => recent.map((j) => JSON.parse(j));
export const currentSeq = () => seq;

type Payload<T extends EngineEventType> = Omit<Extract<EngineEvent, { type: T }>, "seq" | "ts" | "type">;

export function emit<T extends EngineEventType>(type: T, payload: Payload<T>): void {
  const ev = { seq: ++seq, ts: Date.now(), type, ...payload };
  const json = JSON.stringify(ev);
  recent.push(json);
  if (recent.length > 200) recent.shift();
  const chunk = `data: ${json}\n\n`;
  for (const l of listeners) {
    try { l(chunk); } catch { listeners.delete(l); }
  }
}

// The snapshot carries the current seq so clients can drop anything older.
export function snapshotChunk(): string {
  return `data: ${JSON.stringify({ seq, ts: Date.now(), type: "state.snapshot", state: store.state })}\n\n`;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function listenerCount(): number {
  return listeners.size;
}
