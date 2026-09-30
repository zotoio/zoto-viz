/**
 * #186: the source stamp of web/scripts/pack-install-lint.built.mjs. The build records the
 * repo-relative files esbuild read and a digest of their bytes; bundle-pack-entry.mjs recomputes it
 * before it trusts the built lint, so a file that no longer matches its TypeScript source is refused
 * (exit 3, the setup sentence) instead of linting with old rules. `pnpm install` in web/ rebuilds it.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const BUILT_LINT_FILE = "pack-install-lint.built.mjs";

/** sha256 over `rel \0 bytes \0` for each input, in sorted order. */
export function inputsDigest(root, inputs) {
  const h = createHash("sha256");
  for (const rel of [...inputs].sort()) {
    h.update(rel);
    h.update("\0");
    h.update(fs.readFileSync(path.join(root, rel)));
    h.update("\0");
  }
  return h.digest("hex");
}

/** null when `build` (the built file's PACK_INSTALL_LINT_BUILD) matches the sources under `root`; else why not. */
export function staleReason(build, root) {
  if (!build || !Array.isArray(build.inputs) || build.inputs.length === 0 || typeof build.sha256 !== "string") {
    return "built lint has no source stamp";
  }
  let now;
  try {
    now = inputsDigest(root, build.inputs);
  } catch (err) {
    return `built lint sources unreadable: ${String(err?.code || err?.message || err)}`;
  }
  if (now !== build.sha256) {
    return `built lint is stale: sources changed since it was built (${build.sha256.slice(0, 12)} -> ${now.slice(0, 12)})`;
  }
  return null;
}
