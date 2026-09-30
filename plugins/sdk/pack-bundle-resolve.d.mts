/**
 * Types for pack-bundle-resolve.mjs (plain ESM, shared by the pack lint and the esbuild bundler).
 * Keep in step with the JSDoc there.
 */

/** Bare modules the pack bundle leaves external. */
export declare const PACK_BUNDLE_EXTERNALS: Set<string>;

/** `spec` without a `?query` suffix. */
export declare function stripImportSuffix(spec: string): string;

export interface ResolvePackBundleImportOptions {
  specifier: string;
  importerFile: string;
  packHome: string;
  sdkRoot: string;
  repoRoot?: string;
}

export type PackBundleResolveCode =
  | "empty-specifier"
  | "remote-import"
  | "vite-fs-import"
  | "absolute-import"
  | "bare-module"
  | "unknown-specifier"
  | "missing-file"
  | "outside-boundary";

export type PackBundleResolveResult =
  | { ok: true; path: string; zone: "pack" | "sdk" }
  | { ok: true; external: true }
  | { ok: false; code: PackBundleResolveCode; reason: string; resolved?: string };

export declare function resolvePackBundleImport(opts: ResolvePackBundleImportOptions): PackBundleResolveResult;

export interface BundleBoundaryPayload {
  packName?: string;
  packId?: string;
  file?: string;
  import?: string;
}

export declare function formatBundleBoundaryError(payload: BundleBoundaryPayload): string;
