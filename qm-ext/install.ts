// Installs the QM Raid extension into a local QM dev instance without touching QM core and without secrets:
// 1) registers the GBrain MCP facade as QM MCP server "gbrain" (via a turn by an admin QM agent, which uses its own
//    capability token; the admin UI does not relay mcp-servers), 2) registers this repo as a pinned skill pack and
//    imports qm-ext/skills/* (the admin UI relays skill-packs).
// Usage: bun qm-ext/install.ts [--skip-mcp] [--skip-skills]
// Env: QM_PORTAL_URL (default http://localhost:8129), GBRAIN_MCP_URL (default http://127.0.0.1:4617/mcp),
//      RAID_REPO_URL (default https://github.com/aemrebarut/qm-raid), RAID_REF (default: git HEAD, must be pushed)
const PORTAL = (process.env.QM_PORTAL_URL ?? "http://localhost:8129").replace(/\/$/, "");
const MCP_URL = process.env.GBRAIN_MCP_URL ?? "http://127.0.0.1:4617/mcp";
const REPO = process.env.RAID_REPO_URL ?? "https://github.com/aemrebarut/qm-raid";
const args = new Set(process.argv.slice(2));

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${PORTAL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { origin: PORTAL } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function registerMcp(): Promise<void> {
  const cfg = await api<{ scopeId?: string }>("GET", "/api/runtime-config");
  const principal = (cfg.scopeId ?? "personal:emre").replace(/^personal:/, "");
  const body = JSON.stringify({ name: "GBrain", url: MCP_URL, auth: "none", credentialScope: "shared", readOnly: false, enabled: true });
  const text = [
    "Admin setup task. Run exactly this one command with your execute tool, then reply with only the HTTP status line and the JSON body it printed:",
    "",
    `curl -sS -w '\\nHTTP %{http_code}\\n' -X PUT "$AGENT_API_URL/v1/admin/mcp-servers/gbrain" -H "x-agent-capability: $AGENT_API_TOKEN" -H 'content-type: application/json' -d '${body}'`,
  ].join("\n");
  const { runId } = await api<{ runId: string }>("POST", "/api/turn", { text, threadRef: `web:${principal}:raid-setup-${Date.now()}` });
  const deadline = Date.now() + 240_000;
  for (;;) {
    const run = await api<{ status: string; result: { status?: string; reply?: string } | null }>("GET", `/api/runs/${encodeURIComponent(runId)}`);
    if (run.status === "done" || run.status === "failed") {
      const reply = run.result?.reply ?? "";
      console.log(`mcp: ${reply.split("\n").slice(0, 2).join(" ")}`);
      if (!/HTTP 2\d\d/.test(reply)) throw new Error("MCP registration did not return HTTP 2xx");
      return;
    }
    if (Date.now() > deadline) throw new Error("MCP registration turn timed out");
    await Bun.sleep(1500);
  }
}

async function installSkills(): Promise<void> {
  const ref = process.env.RAID_REF ?? (await Bun.$`git rev-parse HEAD`.text()).trim();
  // QM matches skillGlobs against each skill's directory, not the SKILL.md path.
  const spec = { ref, subset: "all", trustTier: "third-party", config: { skillGlobs: ["qm-ext/skills/*"] } };
  const { packs } = await api<{ packs: Array<{ id: string; url: string }> }>("GET", "/admin/api/skill-packs");
  const existing = packs.find((p) => p.url === REPO);
  const id = existing
    ? (await api<{ pack: { id: string } }>("PATCH", `/admin/api/skill-packs/${encodeURIComponent(existing.id)}`, spec), existing.id)
    : (await api<{ pack: { id: string } }>("POST", "/admin/api/skill-packs", { url: REPO, ...spec })).pack.id;
  console.log(`skills: pack ${id} at ${ref.slice(0, 7)}`);
  const imported = await api<{ counts?: Record<string, number>; imported?: unknown[]; updated?: unknown[] }>(
    "POST",
    `/admin/api/skill-packs/${encodeURIComponent(id)}/import`,
    { selected: "all" },
  );
  console.log(`skills: import ${JSON.stringify(imported.counts)} imported=${JSON.stringify(imported.imported)} updated=${JSON.stringify(imported.updated)}`);
  if (!imported.counts?.eligible) throw new Error("no eligible skills found in the pack");
}

if (!args.has("--skip-mcp")) await registerMcp();
if (!args.has("--skip-skills")) await installSkills();
console.log("qm-ext installed");
