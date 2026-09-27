// autopilot: heuristic proposer on the Proposer API (docs/CONTRACT.md). No dependencies.
import { propose, type ProposeRequest } from "./propose.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4613);

const json = (body: unknown, status = 200) => Response.json(body, { status });

Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "autopilot" });
    if (req.method === "POST" && url.pathname === "/propose") {
      let body: ProposeRequest;
      try { body = (await req.json()) as ProposeRequest; } catch { return json({ ok: false, error: "json body required", proposals: [] }, 400); }
      try {
        const proposals = propose(body ?? {});
        console.log(`propose: ${body?.units?.length ?? 0} units, ${body?.targets?.length ?? 0} targets -> ${proposals.map((p) => `${p.unitId}->${p.targetId}`).join(" ") || "none"}`);
        return json({ proposals });
      } catch (e) {
        console.error(e);
        return json({ ok: false, error: String(e), proposals: [] }, 500);
      }
    }
    return json({ ok: false, error: "not found" }, 404);
  },
});

console.log(`autopilot on http://${HOST}:${PORT}`);
