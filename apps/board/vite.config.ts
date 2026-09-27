import { defineConfig, type Plugin } from "vite";

// Board dev server: 127.0.0.1:4611, proxies /api (including SSE) to the engine on 4610.
const ENGINE = process.env.ENGINE_URL ?? "http://127.0.0.1:4610";

// GET /health on the board itself, per the contract rule for every service.
const health: Plugin = {
  name: "board-health",
  configureServer(server) {
    server.middlewares.use("/health", (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, service: "board" }));
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use("/health", (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, service: "board" }));
    });
  },
};

export default defineConfig({
  plugins: [health],
  server: {
    host: "127.0.0.1",
    port: 4611,
    strictPort: true,
    proxy: {
      "/api": { target: ENGINE, changeOrigin: true },
    },
    fs: { allow: ["../.."] }, // contract/types.ts lives at the repo root
  },
  preview: { host: "127.0.0.1", port: 4611, strictPort: true },
});
