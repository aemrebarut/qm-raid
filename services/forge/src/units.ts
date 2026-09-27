// Forge units: the Bridge API (docs/CONTRACT.md) on the forge port. Each unit runs a small agent loop on its
// type's trained model: recall from the brain, answer, remember the learning, reply. The gbrain steps are
// emitted as gbrain.recall / gbrain.remember tool activity so the engine animates them like QM agents.
import type { AskRequest } from "./model";

export interface UnitTypeView { id: string; name: string; description: string; status: string; model: string | null; baseModel: string | null }
interface ForgeUnit { id: string; name: string; typeId: string | null; team: number | null; orderId: string | null; gen: number }
interface SendBody { text?: string; orderId?: string; targetId?: string; componentId?: string }

const BRAIN_URL = process.env.BRAIN_URL ?? "http://127.0.0.1:4616";

export function createUnits(opts: { types: () => UnitTypeView[]; ask: (r: AskRequest) => Promise<string> }) {
  const units = new Map<string, ForgeUnit>();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();

  function emit(ev: Record<string, unknown>) {
    const chunk = enc.encode(`data: ${JSON.stringify(ev)}\n\n`);
    for (const c of clients) { try { c.enqueue(chunk); } catch { clients.delete(c); } }
  }
  setInterval(() => { for (const c of clients) { try { c.enqueue(enc.encode(": ping\n\n")); } catch { clients.delete(c); } } }, 15_000);

  function pickType(model?: string, typeId?: string): UnitTypeView | null {
    const ready = opts.types().filter((t) => t.status === "ready");
    return ready.find((t) => t.id === typeId) ?? ready.find((t) => t.model === model) ?? ready[ready.length - 1] ?? null;
  }

  function ensure(id: string, b: { name?: string; model?: string; team?: number | null; class?: string; typeId?: string } = {}): ForgeUnit {
    let u = units.get(id);
    if (!u) {
      u = { id, name: b.name ?? id, typeId: pickType(b.model, b.typeId ?? b.class)?.id ?? null, team: b.team ?? null, orderId: null, gen: 0 };
      units.set(id, u);
    }
    return u;
  }

  async function brain(path: string, body: unknown): Promise<any> {
    const r = await fetch(`${BRAIN_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`brain ${path} ${r.status}`);
    return r.json();
  }

  async function run(u: ForgeUnit, b: SendBody) {
    const gen = ++u.gen;
    const isOrder = !!b.orderId;
    if (isOrder) u.orderId = b.orderId!;
    const oid = b.orderId ? { orderId: b.orderId } : {};
    const live = () => u.gen === gen && units.has(u.id);
    const act = (kind: string, text: string, tool?: string, args?: unknown) => {
      if (live()) emit(tool ? { type: "activity", unitId: u.id, ...oid, kind, text, tool, args } : { type: "activity", unitId: u.id, ...oid, kind, text });
    };
    const t = opts.types().find((x) => x.id === u.typeId) ?? pickType();
    const text = String(b.text ?? "");
    try {
      if (!t || !t.model) throw new Error("no trained forge type is ready for this unit");
      act("thinking", `Reading the order: ${text.slice(0, 120)}`);
      let context = "";
      if (isOrder && (b.componentId || b.targetId)) {
        try {
          const rec = await brain("/recall", { componentId: b.componentId, targetId: b.targetId, unitId: u.id });
          context = typeof rec.context === "string" ? rec.context : JSON.stringify(rec.context ?? "");
          const slugs: string[] = Array.isArray(rec.slugs) ? rec.slugs : [];
          act("tool", `Recalled ${slugs.length} pages about ${b.componentId ?? b.targetId}`, "gbrain.recall",
            { query: `${b.componentId ?? ""} ${b.targetId ?? ""}`.trim(), slugs });
        } catch (e) {
          act("message", `The Library did not answer (${(e as Error).message}); working from training alone.`);
        }
      }
      if (!live()) return;
      act("thinking", `Thinking with the ${t.name} model (${t.model.startsWith("dry-run:") ? "dry run" : "River"})`);
      const answer = await opts.ask({ typeId: t.id, name: t.name, description: t.description, model: t.model, baseModel: t.baseModel,
        order: text, context, targetId: b.targetId });
      if (!live()) return;
      const plan = answer.split("\n").filter((l) => /^(Plan|Decision):/i.test(l.trim())).join(" ") || answer.slice(0, 280);
      act("message", plan.slice(0, 400));
      if (isOrder && b.targetId) {
        const learning = answer.split("\n").find((l) => /^Remember:/i.test(l.trim()))?.replace(/^\s*Remember:\s*/i, "")
          || answer.slice(0, 300);
        try {
          const rem = await brain("/remember", { unitId: u.id, targetId: b.targetId, text: `${u.name} (${t.name}): ${learning}` });
          act("tool", `Remembered: ${learning.slice(0, 120)}`, "gbrain.remember", { slug: rem.slug, text: learning });
        } catch (e) {
          act("message", `Could not write to the Library (${(e as Error).message}).`);
        }
      }
      if (!live()) return;
      emit({ type: "reply", unitId: u.id, ...oid, text: answer });
    } catch (e) {
      if (live()) emit(isOrder ? { type: "error", unitId: u.id, ...oid, text: `${u.name}: ${(e as Error).message}` }
                               : { type: "activity", unitId: u.id, kind: "error", text: `${u.name}: ${(e as Error).message}` });
    } finally {
      if (u.gen === gen && isOrder) u.orderId = null;
    }
  }

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  // Returns a Response for Bridge API routes, or null when the path is not ours.
  async function handle(req: Request, url: URL): Promise<Response | null> {
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const m = req.method;
    if (m === "GET" && url.pathname === "/events") {
      let ctrl: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) { ctrl = c; clients.add(c); c.enqueue(enc.encode(": connected\n\n")); },
        cancel() { clients.delete(ctrl); },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
    }
    if (parts[0] !== "units") return null;
    const id = parts[1];
    const body = async () => (await req.json().catch(() => null)) as any;
    if (!id) {
      if (m === "GET") return json([...units.values()].map(({ gen, ...u }) => u));
      if (m === "POST") {
        const b = await body();
        if (!b || typeof b.id !== "string" || !b.id) return json({ ok: false, error: "id required" }, 400);
        const u = ensure(b.id, b);
        console.log(`[forge] spawn unit ${u.id} (${u.name}) type ${u.typeId ?? "none ready"}`);
        return json({ sessionId: `forge-${u.id}`, sessionUrl: null });
      }
    } else if (parts.length === 2) {
      if (m === "PATCH") {
        const u = units.get(id);
        if (!u) return json({ ok: false, error: "unknown unit" }, 404);
        const b = await body();
        if (b && b.team !== undefined) u.team = b.team;
        return json({ ok: true });
      }
      if (m === "DELETE") { const u = units.get(id); if (u) { u.gen++; units.delete(id); } return json({ ok: true }); }
    } else if (parts.length === 3 && parts[2] === "send" && m === "POST") {
      const b = (await body()) as SendBody | null;
      if (!b || typeof b.text !== "string" || !b.text.trim()) return json({ ok: false, error: "text required" }, 400);
      const u = ensure(id);
      run(u, b).catch((e) => console.error("[forge] unit loop", e));
      return json({ ok: true });
    }
    return json({ ok: false, error: "not found" }, 404);
  }

  return { handle };
}
