/** Types for pack-bundle-resolve.mjs (shared by the SDK bundler, pack lint and tests). */

export const PACK_BUNDLE_EXTERNALS: Set<string>;

export function stripImportSuffix(spec: string): string;

export function resolvePackBundleImport(opts: {
  specifier: string;
  importerFile: string;
  packHome: string;
  sdkRoot: string;
  repoRoot?: string;
}):
  | { ok: true; path: string; zone: "pack" | "sdk" }
  | { ok: true; external: true }
  | { ok: false; reason: string; code: string };

export function formatBundleBoundaryError(payload: {
  packName?: string;
  packId?: string;
  [key: string]: unknown;
}): string;
