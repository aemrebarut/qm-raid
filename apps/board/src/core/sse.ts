// Connects the store to the engine: GET /api/state, then SSE /api/events (EventSource auto-reconnects).
// If the engine is unreachable the store keeps the fixture state and connection = "fixture".
import type { Store } from "./store";
import type { EngineEvent } from "./types";
import { api } from "./api";

export function connectEngine(store: Store, url = "/api/events"): () => void {
  let es: EventSource | null = null;
  let live = false;
  let closed = false;

  api.state().then((s) => {
    if (closed) return;
    if (s) { store.setState(s); store.setConnection("live"); live = true; }
    else if (!live) store.setConnection("fixture");
  });

  es = new EventSource(url);
  es.onmessage = (msg) => {
    let ev: EngineEvent;
    try { ev = JSON.parse(msg.data); } catch { return; }
    if (!live) { live = true; }
    store.setConnection("live");
    store.apply(ev);
  };
  es.onerror = () => {
    // EventSource retries on its own; keep the last known state on screen.
    store.setConnection(live ? "reconnecting" : "fixture");
  };

  return () => { closed = true; es?.close(); };
}
