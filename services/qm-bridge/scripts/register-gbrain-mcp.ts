// Registers the GBrain MCP facade (services/brain, 127.0.0.1:4617/mcp) as a QM MCP server, holding no secrets:
// the admin UI does not relay /v1/admin/mcp-servers, but that route accepts agent capability auth ("either"),
// so we ask a QM agent running as the admin principal to make the call from its sandbox with its own token.
// Usage: bun scripts/register-gbrain-mcp.ts   (env: QM_PORTAL_URL, GBRAIN_MCP_URL)
import { startTurn, threadRefFor, waitRun } from "../src/qm.ts";

const MCP_URL = process.env.GBRAIN_MCP_URL ?? "http://127.0.0.1:4617/mcp";
const body = JSON.stringify({ name: "GBrain", url: MCP_URL, auth: "none", credentialScope: "shared", readOnly: false, enabled: true });

const text = [
  "Admin setup task. Run exactly this one command with your execute tool, then reply with only the HTTP status line and the JSON body it printed:",
  "",
  `curl -sS -w '\\nHTTP %{http_code}\\n' -X PUT "$AGENT_API_URL/v1/admin/mcp-servers/gbrain" -H "x-agent-capability: $AGENT_API_TOKEN" -H 'content-type: application/json' -d '${body}'`,
].join("\n");

const threadRef = await threadRefFor(`raid-setup-${Date.now()}`);
const { runId } = await startTurn(threadRef, text);
console.log(`registration turn queued runId ${runId}`);
const run = await waitRun(runId, 240_000);
console.log(`run status: ${run.status} result: ${run.result?.status}`);
console.log(run.result?.reply ?? run.result?.message ?? run.result?.error ?? "(no reply)");
process.exit(run.result?.status === "ok" && /HTTP 2\d\d/.test(run.result?.reply ?? "") ? 0 : 1);
