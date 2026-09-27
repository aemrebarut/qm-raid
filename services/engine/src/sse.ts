// SSE endpoint for GET /api/events: snapshot first, live events, ": ping" every 15 s.
// A client that stops reading is dropped once SSE_MAX_QUEUE chunks wait for it, instead of buffering forever.
import { SSE_MAX_QUEUE } from "./config.ts";
import { snapshotChunk, subscribe } from "./store.ts";
import { logOnce } from "./http.ts";

export function sseResponse(req: Request, headers: Record<string, string>): Response {
  const enc = new TextEncoder();
  let unsub = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const close = (why: string) => {
        if (closed) return;
        closed = true;
        unsub();
        clearInterval(ping);
        if (why) logOnce("sse-drop", `dropped SSE client: ${why}`, 10000);
        try { ctrl.close(); } catch {}
      };
      const send = (chunk: string) => {
        if (closed) return;
        if ((ctrl.desiredSize ?? 0) < -SSE_MAX_QUEUE) return close(`more than ${SSE_MAX_QUEUE} events unread`);
        try { ctrl.enqueue(enc.encode(chunk)); } catch { close(""); }
      };
      send(snapshotChunk());
      unsub = subscribe(send);
      ping = setInterval(() => send(": ping\n\n"), 15000);
      req.signal.addEventListener("abort", () => close(""));
    },
    cancel() {
      closed = true;
      unsub();
      clearInterval(ping);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...headers } });
}
