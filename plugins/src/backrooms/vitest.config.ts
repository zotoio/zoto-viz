import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packRoot, "../../..");

/** Pack-local vitest (run from `web/`: `pnpm exec vitest run --config ../plugins/src/backrooms/vitest.config.ts`). */
export default defineConfig({
  test: {
    root: packRoot,
    environment: "happy-dom",
    include: ["**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@sdk": path.resolve(packRoot, "../../sdk"),
    },
  },
  server: {
    fs: { allow: [repoRoot] },
  },
});
