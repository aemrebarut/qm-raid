import { defineConfig } from "vite";

// Art showroom: every asset, animation and effect on a turntable. 127.0.0.1:4620, talks to nothing.
export default defineConfig({
  root: "showroom",
  cacheDir: "../.vite-showroom", // node_modules is the board's (symlink); keep our own optimizer cache
  server: {
    host: "127.0.0.1",
    port: 4620,
    strictPort: true,
    fs: { allow: ["../.."] }, // three lives in apps/board/node_modules
    // Never crawl the symlinked board node_modules or the repo (the watcher pinned the CPU otherwise).
    watch: { ignored: ["**/node_modules/**", "**/.vite-showroom/**", "**/test/**"] },
  },
  optimizeDeps: { include: ["three", "three/addons/controls/OrbitControls.js"] },
  resolve: { dedupe: ["three"] },
  plugins: [
    {
      name: "art-health",
      configureServer(server) {
        server.middlewares.use("/health", (_req, res) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: true, service: "art" }));
        });
      },
    },
  ],
});
