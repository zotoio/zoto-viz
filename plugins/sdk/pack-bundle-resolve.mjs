// @ts-check
/**
 * Shared pack bundle import resolver (lint + esbuild must agree).
 * #192: typed by the JSDoc here (web/tsconfig.test.json includes this file; allowJs, checkJs off);
 * there is no separate .d.mts.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {"empty-specifier" | "remote-import" | "vite-fs-import" | "absolute-import" | "bare-module"
 *   | "unknown-specifier" | "missing-file" | "outside-boundary"} PackBundleResolveCode
 */
/**
 * @typedef {{ specifier: string, importerFile: string, packHome: string, sdkRoot: string, repoRoot?: string }}
 *   ResolvePackBundleImportOptions
 */
/**
 * @typedef {{ ok: true, path: string, zone: "pack" | "sdk" }
 *   | { ok: true, external: true }
 *   | { ok: false, code: PackBundleResolveCode, reason: string, resolved?: string }} PackBundleResolveResult
 */
/** @typedef {{ packName?: string, packId?: string, file?: string, import?: string }} BundleBoundaryPayload */

/** Bare modules the pack bundle leaves external. */
export const PACK_BUNDLE_EXTERNALS = new Set(["three", "d3-force-3d"]);

/**
 * `spec` without a `?query` suffix.
 * @param {string} spec
 * @returns {string}
 */
export function stripImportSuffix(spec) {
  const q = spec.indexOf("?");
  return q >= 0 ? spec.slice(0, q) : spec;
}

/**
 * @param {string} abs
 * @returns {string | null}
 */
function realpathSafe(abs) {
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return null;
  }
}

/**
 * @param {string} root
 * @param {string} candidate
 * @returns {boolean}
 */
function insideRoot(root, candidate) {
  const realRoot = realpathSafe(root);
  const realCand = realpathSafe(candidate);
  if (!realRoot || !realCand) return false;
  const rel = path.relative(realRoot, realCand);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * @param {string} baseAbs
 * @returns {string}
 */
function resolveWithExtensions(baseAbs) {
  const tries = [
    baseAbs,
    `${baseAbs}.ts`,
    `${baseAbs}.tsx`,
    `${baseAbs}.mts`,
    `${baseAbs}.js`,
    `${baseAbs}.mjs`,
    `${baseAbs}.json`,
    path.join(baseAbs, "index.ts"),
  ];
  for (const candidate of tries) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return baseAbs;
}

/**
 * @param {string} spec
 * @returns {boolean}
 */
function isRemoteSpecifier(spec) {
  return /^https?:\/\//i.test(stripImportSuffix(spec));
}

/**
 * @param {string} spec
 * @returns {boolean}
 */
function isViteFsSpecifier(spec) {
  return stripImportSuffix(spec).startsWith("/@fs/");
}

/**
 * @param {string} spec
 * @returns {boolean}
 */
function isBareModule(spec) {
  const bare = stripImportSuffix(spec);
  if (!bare || bare.startsWith(".") || bare.startsWith("/")) return false;
  if (bare.includes("plugins/sdk/")) return false;
  return true;
}

/**
 * @param {ResolvePackBundleImportOptions} opts
 * @returns {PackBundleResolveResult}
 */
export function resolvePackBundleImport(opts) {
  const { specifier, importerFile, packHome, sdkRoot, repoRoot } = opts;
  const bare = stripImportSuffix(specifier);
  if (!bare) {
    return { ok: false, code: "empty-specifier", reason: "empty import specifier" };
  }
  if (PACK_BUNDLE_EXTERNALS.has(bare)) {
    return { ok: true, external: true };
  }
  if (isRemoteSpecifier(bare)) {
    return { ok: false, code: "remote-import", reason: `remote URL imports are not allowed (${bare})` };
  }
  if (isViteFsSpecifier(bare)) {
    return { ok: false, code: "vite-fs-import", reason: `/@fs/ imports are not allowed (${bare})` };
  }
  if (path.isAbsolute(bare)) {
    return { ok: false, code: "absolute-import", reason: `absolute imports are not allowed (${bare})` };
  }
  if (isBareModule(bare)) {
    return { ok: false, code: "bare-module", reason: `bare module imports are not allowed (${bare}); only three and d3-force-3d are external` };
  }

  const importerDir = path.dirname(importerFile);
  /** @type {string} */
  let abs;
  const packSdkRel = bare.match(/^(?:\.\.\/)+sdk\/(.+)$/);
  if (packSdkRel) {
    const candidate = resolveWithExtensions(path.normalize(path.join(sdkRoot, packSdkRel[1])));
    if (!insideRoot(sdkRoot, candidate)) {
      return {
        ok: false,
        code: "outside-boundary",
        reason: `import escapes pack and SDK (${bare})`,
        resolved: candidate,
      };
    }
    abs = candidate;
  } else if (bare.startsWith(".")) {
    abs = resolveWithExtensions(path.normalize(path.join(importerDir, bare)));
  } else if (bare.includes("plugins/sdk/") || bare.startsWith("plugins/sdk/")) {
    const tail = bare.replace(/^.*plugins\/sdk\//, "");
    abs = resolveWithExtensions(path.join(sdkRoot, tail));
  } else if (repoRoot && (bare.includes("plugins/src/") || bare.startsWith("plugins/src/"))) {
    abs = resolveWithExtensions(path.join(repoRoot, bare.replace(/^\.\/+/, "")));
  } else {
    return { ok: false, code: "unknown-specifier", reason: `unsupported import (${bare})` };
  }

  const real = realpathSafe(abs);
  if (!real || !fs.existsSync(real)) {
    return { ok: false, code: "missing-file", reason: `import resolves to missing file (${bare})` };
  }
  if (insideRoot(packHome, real)) {
    return { ok: true, path: real, zone: "pack" };
  }
  if (insideRoot(sdkRoot, real)) {
    return { ok: true, path: real, zone: "sdk" };
  }
  return {
    ok: false,
    code: "outside-boundary",
    reason: `import escapes pack and SDK (${bare})`,
    resolved: real,
  };
}

/**
 * #185: same shape as service/pack_block_copy.py. The file, the import and the README link are
 * diagnostics (payload fields / the log), never user text.
 * @param {BundleBoundaryPayload} payload
 * @returns {string}
 */
export function formatBundleBoundaryError(payload) {
  const { packName, packId } = payload;
  const name = packName || packId || "Plugin";
  return (
    `${name} was blocked because it loads code from outside its own folder. `
    + "Nothing was installed, and your wall is unchanged. "
    + "If you made this pack, run pack lint to see what to fix."
  );
}
