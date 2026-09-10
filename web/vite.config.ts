import { defineConfig } from "vite";

// `pnpm dev` proxies the WebSocket and JSON API to a running ./monitor.py on :8765
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:8765", ws: true },
      "/api": { target: "http://127.0.0.1:8765" },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
