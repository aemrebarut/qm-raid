// Engine service: game state, orders, teams and the SSE event stream on 127.0.0.1:4610.
import { BRAIN_URL, BRIDGE_URL, HOST, PORT } from "./config.ts";
import { startGame } from "./game.ts";
import { handle } from "./app.ts";

process.on("unhandledRejection", (err) => console.error("[engine] unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("[engine] uncaught exception:", err));

await startGame();

Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 0, // SSE streams stay open; Bun's default 10 s idle timeout would cut them
  fetch: handle,
});

console.log(`[engine] listening on http://${HOST}:${PORT} (bridge ${BRIDGE_URL}, brain ${BRAIN_URL})`);
