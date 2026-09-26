import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

/** Bootstrap page only — not exposed from the static root (served via /pack-assets/<token>/_sandbox/). */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        "plugin-sandbox": path.resolve(webRoot, "plugin-sandbox.html"),
      },
    },
  },
});
