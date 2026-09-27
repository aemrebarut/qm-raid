// Bridge API client (mock-bridge 4615, qm-bridge 4614, forge 4612) and SSE subscriber.
import type { BridgeEvent, SendRequest, SpawnRequest, SpawnResponse, Unit } from "../../../contract/types.ts";
import { BRIDGE_URL, CLASS_MODELS, FORGE_URL } from "./config.ts";
import { logOnce, sendJson } from "./http.ts";

// Built-in classes go to BRIDGE_URL; forged types go to the Forge.
export function bridgeFor(unit: Unit): string {
  return CLASS_MODELS[unit.class] ? BRIDGE_URL : FORGE_URL;
}

export async function spawnOnBridge(unit: Unit): Promise<SpawnResponse | null> {
  const req: SpawnRequest = { id: unit.id, name: unit.name, model: unit.model, effort: unit.effort, role: unit.role, team: unit.team };
  const r = await sendJson<SpawnResponse>("POST", `${bridgeFor(unit)}/units`, req, 20000);
  if (r.status < 200 || r.status >= 300 || !r.data) {
    logOnce(`spawn:${bridgeFor(unit)}`, `bridge spawn failed at ${bridgeFor(unit)} (status ${r.status})`);
    return null;
  }
  return { sessionId: r.data.sessionId ?? null, sessionUrl: r.data.sessionUrl ?? null };
}

// Returns the HTTP status (0 when the bridge is unreachable).
export async function sendToBridge(unit: Unit, req: SendRequest): Promise<number> {
  const r = await sendJson("POST", `${bridgeFor(unit)}/units/${encodeURIComponent(unit.id)}/send`, req, 20000);
  return r.status;
}

export async function patchOnBridge(unit: Unit, team: number | null): Promise<void> {
  await sendJson("PATCH", `${bridgeFor(unit)}/units/${encodeURIComponent(unit.id)}`, { team });
}

export async function deleteOnBridge(unit: Unit): Promise<void> {
  await sendJson("DELETE", `${bridgeFor(unit)}/units/${encodeURIComponent(unit.id)}`, undefined);
}

// Follows GET <base>/events forever, reconnecting every 2 s. onConnect runs after each (re)connect.
export function followBridgeEvents(base: string, onEvent: (e: BridgeEvent) => void, onConnect: () => void): void {
  const loop = async () => {
    for (;;) {
      try {
        const r = await fetch(`${base}/events`, { headers: { accept: "text/event-stream" } });
        if (!r.ok || !r.body) throw new Error(`status ${r.status}`);
        console.log(`[engine] connected to bridge events at ${base}`);
        onConnect();
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
            const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
            if (!data) continue;
            try {
              onEvent(JSON.parse(data) as BridgeEvent);
            } catch (err) {
              logOnce(`parse:${base}`, `bad bridge event from ${base}: ${String(err).slice(0, 120)}`, 5000);
            }
          }
        }
        logOnce(`closed:${base}`, `bridge events closed at ${base}, reconnecting`, 5000);
      } catch (err) {
        logOnce(`down:${base}`, `bridge events unavailable at ${base} (${String(err).slice(0, 80)}), retrying every 2 s`);
      }
      await Bun.sleep(2000);
    }
  };
  void loop();
}
