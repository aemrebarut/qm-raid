// Connects the store to the engine: GET /api/state, then SSE /api/events (EventSource auto-reconnects).
// If the engine is unreachable the store keeps the fixture state and connection = "fixture".
// The SSE stream is authoritative: once any SSE message has been applied, a late GET /api/state is ignored.
import type { Store } from "./store";
import type { EngineEvent } from "./types";
import { api } from "./api";

export function connectEngine(store: Store, url = "/api/events"): () => void {
  let sseSeen = false;
  let closed = false;

  api.state().then((s) => {
    if (closed || sseSeen) return;
    if (s) { store.setState(s); store.setConnection("live"); }
    else store.setConnection("fixture");
  });

  const es = new EventSource(url);
  es.onmessage = (msg) => {
    let ev: EngineEvent;
    try { ev = JSON.parse(msg.data); } catch { return; }
    sseSeen = true;
    store.setConnection("live");
    store.apply(ev);
  };
  es.onerror = () => {
    // EventSource retries on its own; keep the last known state on screen.
    store.setConnection(sseSeen ? "reconnecting" : "fixture");
  };

  return () => { closed = true; es.close(); };
}
