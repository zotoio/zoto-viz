/**
 * Runner-owned vitest config overlay: merges project config with revert-proof
 * setupFiles + custom runner. Vitest 5.0.0 has no CLI --setupFiles flag.
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

function resolveVitePkgRoot(root) {
  for (const rel of ["web/node_modules/vite", "node_modules/vite"]) {
    const pkgRoot = path.join(root, rel);
    if (fs.existsSync(path.join(pkgRoot, "package.json"))) {
      return pkgRoot;
    }
  }
  throw new Error(`vite package not found under ${root}`);
}

const vitePkgRoot = resolveVitePkgRoot(wtRoot);
const { loadConfigFromFile } = await import(
  pathToFileURL(path.join(vitePkgRoot, "dist/node/index.js")).href
);
const loaded = await loadConfigFromFile(
  { command: "serve", mode: "test" },
  baseConfigPath,
  path.dirname(baseConfigPath),
);
if (!loaded) {
  throw new Error(`failed to load vitest base config ${baseConfigPath}`);
}
const base = loaded.config;

export default mergeConfig(base, {
  test: {
    setupFiles: [
      path.join(overlayDir, "revert-proof-vitest-setup.ts"),
      ...(base.test?.setupFiles ?? []),
    ],
    runner: path.join(overlayDir, "revert-proof-vitest-runner.mjs"),
    // The setup file and the natively loaded runner must share one brand module instance.
    server: { deps: { external: [/revert-proof-vitest-brand\.mjs$/] } },
  },
});
