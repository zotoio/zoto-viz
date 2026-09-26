/**
 * Runner-owned vitest config overlay: merges project config with revert-proof
 * setupFiles + custom runner. Vitest 5.0.0 has no CLI --setupFiles flag.
 * `node:assert` is aliased to a callable facade so `assert(false)` reaches the
 * runner-branded `ok` export.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const overlayDir = path.dirname(fileURLToPath(import.meta.url));

const baseConfigPath = process.env.REVERT_PROOF_VITEST_BASE_CONFIG;
if (!baseConfigPath) {
  throw new Error("REVERT_PROOF_VITEST_BASE_CONFIG is required");
}

function resolveVitestPkgRoot(root) {
  for (const rel of ["web/node_modules/vitest", "node_modules/vitest"]) {
    const pkgRoot = path.join(root, rel);
    if (fs.existsSync(path.join(pkgRoot, "package.json"))) {
      return pkgRoot;
    }
  }
  throw new Error(`vitest package not found under ${root}`);
}

const wtRoot = process.env.REVERT_PROOF_ROOT
  ? path.resolve(process.env.REVERT_PROOF_ROOT)
  : path.resolve(overlayDir, "..");
const vitestPkgRoot = resolveVitestPkgRoot(wtRoot);
const { mergeConfig } = await import(
  pathToFileURL(path.join(vitestPkgRoot, "dist/config.js")).href
);

const base = (await import(pathToFileURL(baseConfigPath).href)).default;

export default mergeConfig(base, {
  resolve: {
    alias: [
      {
        find: /^(?:node:)?assert\/strict$/,
        replacement: path.join(overlayDir, "revert-proof-node-assert-strict.mjs"),
      },
      {
        find: /^(?:node:)?assert$/,
        replacement: path.join(overlayDir, "revert-proof-node-assert.mjs"),
      },
    ],
  },
  test: {
    setupFiles: [
      path.join(overlayDir, "revert-proof-vitest-setup.ts"),
      ...(base.test?.setupFiles ?? []),
    ],
    runner: path.join(overlayDir, "revert-proof-vitest-runner.mjs"),
  },
});
