import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "../../../web/node_modules/vitest/dist/config.js";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  test: {
    environment: "happy-dom",
    include: ["frontend/**/*.test.ts"],
  },
});
