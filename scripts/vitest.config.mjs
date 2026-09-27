import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.REVERT_PROOF_ROOT
  ? path.resolve(process.env.REVERT_PROOF_ROOT)
  : path.resolve(scriptsDir, "..");
const webRoot = path.join(repoRoot, "web");

export default {
  root: webRoot,
  cacheDir: path.join(webRoot, "node_modules", ".vite"),
  test: {
    environment: "happy-dom",
    setupFiles: [path.join(webRoot, "src/test/setup.ts")],
    include: [path.join(webRoot, "src/**/*.test.ts")],
    testTimeout: 120_000,
    fileParallelism: false,
  },
};
