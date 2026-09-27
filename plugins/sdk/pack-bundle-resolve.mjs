/**
 * Shared pack bundle import resolver (lint + esbuild must agree).
 */
import fs from "node:fs";
import path from "node:path";

export const PACK_BUNDLE_EXTERNALS = new Set(["three", "d3-force-3d"]);

export function stripImportSuffix(spec) {
  const q = spec.indexOf("?");
  return q >= 0 ? spec.slice(0, q) : spec;
}

function realpathSafe(abs) {
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return null;
  }
}

function insideRoot(root, candidate) {
  const realRoot = realpathSafe(root);
  const realCand = realpathSafe(candidate);
  if (!realRoot || !realCand) return false;
  const rel = path.relative(realRoot, realCand);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

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

function isRemoteSpecifier(spec) {
  return /^https?:\/\//i.test(stripImportSuffix(spec));
}

function isViteFsSpecifier(spec) {
  return stripImportSuffix(spec).startsWith("/@fs/");
}

function isBareModule(spec) {
  const bare = stripImportSuffix(spec);
  if (!bare || bare.startsWith(".") || bare.startsWith("/")) return false;
  if (bare.includes("plugins/sdk/")) return false;
  return true;
}

/**
 * @param {{ specifier: string, importerFile: string, packHome: string, sdkRoot: string, repoRoot?: string }} opts
 * @returns {{ ok: true, path: string, zone: 'pack'|'sdk' } | { ok: true, external: true } | { ok: false, reason: string, code: string }}
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

export function formatBundleBoundaryError(payload) {
  const { packName, packId, file, import: imp } = payload;
  const name = packName || packId || "Plugin";
  const loc = file ? ` (\`${file}\`)` : "";
  const spec = imp ? ` (\`${imp}\`)` : "";
  return (
    `${name} was blocked: it imports a file outside its own folder${loc}${spec}. `
    + "Nothing was installed and the current wall is unchanged. "
    + "Ask the pack author to run pack lint — see plugins/sdk/starter/README.md#2-pack-lint."
  );
}
