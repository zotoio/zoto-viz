import type { PackLintRule, PackLintViolation } from "./pack-lint-types";

/**
 * Shipped packs still on `declare const zoto` until PR C (#55) migrates them to `getVizZoto()`.
 * Only ids on this list may carry baselined legacy-zoto lint rows; any other pack fails.
 */
export const LEGACY_DECLARE_ZOTO_PACK_IDS: readonly string[] = [
  "backrooms",
  "blob-mesh",
  "cypher-cic",
  "hn-rain",
  "hn-term",
  "kefrens-bars",
  "lan-pulse",
  "marble-run",
  "nixie-clock",
  "packet-tunnel",
  "pulse-ts",
  "rf-constellation",
  "roto-proto",
  "star-sines",
  "stereo-gram",
  "syscon",
  "talker-storm",
];

export const LEGACY_ZOTO_LINT_RULES: ReadonlySet<PackLintRule> = new Set([
  "inline-zoto-declare",
  "pack-zoto-binding",
]);

export function packIdFromPluginsSrcPath(file: string): string | null {
  const m = file.match(/^plugins\/src\/([^/]+)\//);
  return m?.[1] ?? null;
}

export function isLegacyDeclareZotoPackAllowed(packId: string): boolean {
  return LEGACY_DECLARE_ZOTO_PACK_IDS.includes(packId);
}

/** Legacy zoto violations on packs that are not on the pinned allowlist (always blocking). */
export function legacyZotoViolationsOnDisallowedPacks(violations: PackLintViolation[]): PackLintViolation[] {
  return violations.filter((v) => {
    if (!LEGACY_ZOTO_LINT_RULES.has(v.rule)) return false;
    const packId = packIdFromPluginsSrcPath(v.file);
    return packId != null && !isLegacyDeclareZotoPackAllowed(packId);
  });
}
