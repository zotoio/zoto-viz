import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.REVERT_PROOF_ROOT
  ? path.resolve(process.env.REVERT_PROOF_ROOT)
  : path.resolve(scriptsDir, "..");

export default {
  root: repoRoot,
  cacheDir: path.join(repoRoot, "web", "node_modules", ".vite"),
  test: {
    environment: "happy-dom",
    include: [
      path.join(repoRoot, "web", "src", "**/*.test.ts"),
      path.join(scriptsDir, "**/*.test.ts"),
    ],
    testTimeout: 120_000,
    fileParallelism: false,
  },
};
