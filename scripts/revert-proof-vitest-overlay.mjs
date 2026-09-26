/**
 * Runner-owned vitest config overlay: merges project config with revert-proof
 * setupFiles + custom runner. Vitest 5.0.0 has no CLI --setupFiles flag.
 */
import { mergeConfig } from "vitest/config";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const overlayDir = path.dirname(fileURLToPath(import.meta.url));

const baseConfigPath = process.env.REVERT_PROOF_VITEST_BASE_CONFIG;
if (!baseConfigPath) {
  throw new Error("REVERT_PROOF_VITEST_BASE_CONFIG is required");
}

const base = (await import(pathToFileURL(baseConfigPath).href)).default;

export default mergeConfig(base, {
  test: {
    setupFiles: [
      path.join(overlayDir, "revert-proof-vitest-setup.ts"),
      ...(base.test?.setupFiles ?? []),
    ],
    runner: path.join(overlayDir, "revert-proof-vitest-runner.mjs"),
  },
});
