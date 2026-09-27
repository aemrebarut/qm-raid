// Forge units: the Bridge API (docs/CONTRACT.md) on the forge port. Each unit runs a small agent loop on its
// type's trained model: recall from the brain, answer, remember the learning, reply. The gbrain steps are
// emitted as gbrain.recall / gbrain.remember tool activity so the engine animates them like QM agents.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AskRequest } from "./model";

export interface UnitTypeView { id: string; name: string; description: string; status: string; model: string | null; baseModel: string | null }
// Orders and direct messages have separate generations: a chat never abandons the active order; a new order supersedes the old one.
export interface Loadout { instructions: string; skills: string[]; plugins: string[] }
interface ForgeUnit { id: string; name: string; typeId: string | null; team: number | null; orderId: string | null; gen: number; chatGen: number; loadout?: Loadout }
// Forge units have one plugin (the team brain) and no QM skills.
export const CATALOG = [{ id: "gbrain", name: "GBrain", kind: "plugin",
  description: "The team brain (Library): recall house rules and past learnings before an order, remember the learning after." }];
interface SendBody { text?: string; orderId?: string; targetId?: string; componentId?: string }

// Splits a unit answer into its house-style sections; tolerates "**Plan:**", "## Plan:" and content on the next lines.
const HEAD = /^\s*(?:#+\s*)?\**\s*(Recall|Plan|Decision|Customer (?:reply|update)|Remember)\s*\**\s*:\s*\**\s*(.*)$/i;
export function sections(text: string): Record<string, string> {
  const out: Record<string, string[]> = {};
  let cur: string | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(HEAD);
    if (m) { cur = m[1].toLowerCase().replace("customer update", "customer reply"); out[cur] = m[2] ? [m[2]] : []; }
    else if (cur) out[cur].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join(" ").replace(/\s+/g, " ").trim()]));
}

// The engine's order prompt is written for QM agents (tool-call instructions, page lists). A forge unit's loop does
// recall and remember itself, so the model only sees the order facts, like its training orders.
export function orderFacts(text: string): string {
  const keep = text.split("\n").filter((l) => !/^\s*(GBrain pages:|Lumen is a synthetic product)/i.test(l));
  return keep.join("\n").trim() || text;
}

// A valid reviewer verdict (docs/CONTRACT.md team workflows): APPROVED, or CHANGES with what to change.
const VERDICT_LINE = /^\W*VERDICT:\s*(APPROVED(?:\s*\([^)]*\))?|CHANGES:\s*\S.*?)[\s*_`.]*$/i;
const verdictOf = (line: string) => { const m = line.trim().match(VERDICT_LINE); return m ? `VERDICT: ${m[1].replace(/^approved$/i, "APPROVED").replace(/^changes:/i, "CHANGES:")}` : null; };
export const finalVerdict = (text: string) => verdictOf(text.trimEnd().split("\n").pop() ?? "");
export const lastVerdict = (text: string) => text.split("\n").map(verdictOf).filter(Boolean).pop() ?? null;

// Workflow orders carry this node's "Role: <role>. <instructions>" line, then "Previous work:" with earlier replies
// (engine briefText). Only this node's own instructions decide what it must do: a reviewer's VERDICT quoted in
// previous work does not make an implementer or a herald a reviewer.
export function roleOf(text: string): { role: string; instructions: string } | null {
  const own = text.split(/\nPrevious work:/)[0];
  const at = own.search(/^Role:/m);
  const m = at < 0 ? null : own.slice(at).match(/^Role:\s*([^.\n]+)\.\s*([\s\S]*)$/); // instructions may span several lines
  return m ? { role: m[1].trim().toLowerCase(), instructions: m[2].trim() } : null;
}

export function createUnits(opts: { types: () => UnitTypeView[]; ask: (r: AskRequest) => Promise<string>; store: string; brainUrl?: string }) {
  const brainUrl = opts.brainUrl ?? process.env.BRAIN_URL ?? "http://127.0.0.1:4616";
  const units = new Map<string, ForgeUnit>();
  // Persisted so a forge restart keeps each unit bound to its type (the engine spawns a unit only once).
  const persist = () => {
    try { writeFileSync(opts.store, JSON.stringify([...units.values()].map(({ id, name, typeId, team, loadout }) => ({ id, name, typeId, team, loadout })))); }
    catch (e) { console.error("[forge] units save failed", e); }
  };
  if (existsSync(opts.store)) {
    try { for (const u of JSON.parse(readFileSync(opts.store, "utf8"))) units.set(u.id, { ...u, orderId: null, gen: 0, chatGen: 0 }); }
    catch (e) { console.error("[forge] units load failed", e); }
  }
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();

  function emit(ev: Record<string, unknown>) {
    const chunk = enc.encode(`data: ${JSON.stringify(ev)}\n\n`);
    for (const c of clients) { try { c.enqueue(chunk); } catch { clients.delete(c); } }
  }
  setInterval(() => { for (const c of clients) { try { c.enqueue(enc.encode(": ping\n\n")); } catch { clients.delete(c); } } }, 15_000);

  function pickType(model?: string, typeId?: string): UnitTypeView | null {
    const ready = opts.types().filter((t) => t.status === "ready");
    // Fallback: the newest River-trained type; a dry-run (smoke) type only if nothing real is ready.
    const real = ready.filter((t) => t.model && !t.model.startsWith("dry-run:"));
    return ready.find((t) => t.id === typeId) ?? ready.find((t) => t.model === model) ?? real[real.length - 1] ?? ready[ready.length - 1] ?? null;
  }

  function pickReal(): UnitTypeView | null {
    return opts.types().filter((t) => t.status === "ready" && t.model && !t.model.startsWith("dry-run:")).pop() ?? null;
  }

  function ensure(id: string, b: { name?: string; model?: string; team?: number | null; class?: string; typeId?: string } = {}): ForgeUnit {
    let u = units.get(id);
    if (!u) {
      u = { id, name: b.name ?? id, typeId: pickType(b.model, b.typeId ?? b.class)?.id ?? null, team: b.team ?? null, orderId: null, gen: 0, chatGen: 0 };
      units.set(id, u);
      persist();
    }
    return u;
  }

  async function brain(path: string, body: unknown): Promise<any> {
    const r = await fetch(`${brainUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`brain ${path} ${r.status}`);
    return r.json();
  }

  async function run(u: ForgeUnit, b: SendBody) {
    const isOrder = !!b.orderId;
    const gen = isOrder ? ++u.gen : ++u.chatGen;
    if (isOrder) u.orderId = b.orderId!;
    const oid = b.orderId ? { orderId: b.orderId } : {};
    const live = () => (isOrder ? u.gen : u.chatGen) === gen && units.has(u.id);
    const act = (kind: string, text: string, tool?: string, args?: unknown) => {
      if (live()) emit(tool ? { type: "activity", unitId: u.id, ...oid, kind, text, tool, args } : { type: "activity", unitId: u.id, ...oid, kind, text });
    };
    let t = opts.types().find((x) => x.id === u.typeId && x.status === "ready") ?? null;
    if (!t && (t = pickReal())) { // its type was deleted from the Forge: rebind to the newest River type, never a dry one
      console.log(`[forge] unit ${u.id}: type ${u.typeId ?? "none"} is gone, rebinding to ${t.id}`);
      u.typeId = t.id;
      persist();
    }
    const text = String(b.text ?? "");
    try {
      if (!t || !t.model) throw new Error("its forge type is gone and no River-trained type is ready");
      const brainOn = !u.loadout || u.loadout.plugins.includes("gbrain");
      act("thinking", `Reading the order: ${text.slice(0, 120)}`);
      let context = "";
      if (isOrder && !brainOn) act("message", "GBrain is off in this unit's loadout: no recall, no remember.");
      if (isOrder && brainOn && (b.componentId || b.targetId)) {
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
      const ask = { typeId: t.id, name: t.name, description: t.description, model: t.model, baseModel: t.baseModel,
        order: isOrder ? orderFacts(text) : text, context, targetId: b.targetId, instructions: u.loadout?.instructions };
      let answer: string;
      try {
        answer = await opts.ask(ask);
      } catch (e) {
        // River slow or down: answer in the type's template voice so the order still completes, and say so.
        if (t.model.startsWith("dry-run:")) throw e;
        act("error", `River did not answer (${(e as Error).message.slice(0, 120)}); answering from the ${t.name} template instead.`);
        answer = "[template fallback, River unavailable]\n" + await opts.ask({ ...ask, model: `dry-run:${t.id}` });
      }
      if (!live()) return;
      // Team workflows: a reviewer's reply must end with a valid VERDICT line. The house-style model may put it
      // elsewhere, write an invalid one, or none: reuse its last valid verdict, else ask once more, else approve visibly.
      const role = roleOf(text);
      if (role && /VERDICT/.test(role.instructions) && !finalVerdict(answer)) {
        let verdict = lastVerdict(answer);
        if (!verdict) {
          act("thinking", "Deciding the review verdict");
          const v = await opts.ask({ ...ask, previous: answer,
            followup: `Your instructions: ${role.instructions}\nEnd now with exactly one final line: VERDICT: APPROVED (a short note in parentheses is allowed), or VERDICT: CHANGES: <what to change>.` }).catch(() => "");
          if (!live()) return;
          verdict = lastVerdict(v);
        }
        if (!verdict) act("message", "No valid verdict from the model; approving by default.");
        answer = `${answer.trimEnd()}\n${verdict ?? "(No valid verdict from the model; approved by default.)\nVERDICT: APPROVED"}`;
      }
      const sec = sections(answer);
      // Herald: the customer update is the point, and the engine shows the start of a reply as the handoff summary.
      if (role?.role === "herald" && sec["customer reply"]) answer = `${sec["customer reply"]}\n\n${answer}`;
      const plan = [sec.plan && `Plan: ${sec.plan}`, sec.decision && `Decision: ${sec.decision}`].filter(Boolean).join(" ")
        || answer.replace(/\s+/g, " ").slice(0, 280);
      act("message", plan.slice(0, 400));
      const learning = (sec.remember || sec.decision || "").slice(0, 400);
      if (isOrder && brainOn && b.targetId && learning) {
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
      if (isOrder && u.gen === gen) u.orderId = null;
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
    if (m === "GET" && url.pathname === "/catalog") return json({ items: CATALOG });
    if (parts[0] !== "units") return null;
    const id = parts[1];
    const body = async () => (await req.json().catch(() => null)) as any;
    if (!id) {
      if (m === "GET") return json([...units.values()].map(({ gen, chatGen, ...u }) => u));
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
        if (b && b.team !== undefined) { u.team = b.team; persist(); }
        const notes: string[] = [];
        if (b?.loadout && typeof b.loadout === "object") {
          // Loadout (docs/CONTRACT.md): instructions extend the agent loop's system prompt; the only plugin is gbrain.
          const l = b.loadout, list = (x: unknown) => (Array.isArray(x) ? x.filter((v) => typeof v === "string") : []);
          u.loadout = { instructions: typeof l.instructions === "string" ? l.instructions.slice(0, 4000) : u.loadout?.instructions ?? "",
            skills: list(l.skills), plugins: l.plugins === undefined ? u.loadout?.plugins ?? ["gbrain"] : list(l.plugins) };
          if (u.loadout.skills.length) notes.push("forge units have no QM skills; skills are stored but not used");
          const unknown = u.loadout.plugins.filter((p) => p !== "gbrain");
          if (unknown.length) notes.push(`only the gbrain plugin exists for forge units (ignored: ${unknown.join(", ")})`);
          emit({ type: "activity", unitId: u.id, kind: "message", text: `Loadout changed: ${u.loadout.instructions ? "new standing orders" : "no standing orders"}, GBrain ${u.loadout.plugins.includes("gbrain") ? "on" : "off"}.` });
        }
        if (typeof b?.model === "string" && b.model) { // a forge unit's model is its trained type: accept a ready type id or model
          const t = opts.types().find((x) => x.status === "ready" && (x.id === b.model || x.model === b.model));
          if (t) u.typeId = t.id; else notes.push(`model ${b.model} is not a ready forge type; kept ${u.typeId}`);
        }
        if (b?.effort !== undefined) notes.push("effort does not apply to forge units");
        persist();
        return json({ ok: true, loadout: u.loadout ?? { instructions: "", skills: [], plugins: ["gbrain"] }, typeId: u.typeId, ...(notes.length ? { notes } : {}) });
      }
      if (m === "DELETE") { const u = units.get(id); if (u) { u.gen++; u.chatGen++; units.delete(id); persist(); } return json({ ok: true }); }
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
