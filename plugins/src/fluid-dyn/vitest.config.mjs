import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const requireFromWeb = createRequire(path.join(root, "../../../web/package.json"));
const { defineConfig } = requireFromWeb("vitest/config");

export default defineConfig({
  root,
  server: {
    fs: { allow: [path.join(root, "../../..")] },
  },
  test: {
    environment: "node",
    include: ["frontend/**/*.test.ts"],
  },
});
