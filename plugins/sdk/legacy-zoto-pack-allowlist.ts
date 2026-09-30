import type { PackLintRule, PackLintViolation } from "./pack-lint-types";

/**
 * Shipped packs still on `declare const zoto`. Empty since #210 moved the last six (ant-colony,
 * aquarium, koi-pond, metro-lines, rocket-car-soccer, voxel-world) to `getVizZoto()`, so an
 * `inline-zoto-declare` in any pack now fails pack lint and blocks pack install. Keep it empty.
 */
export const LEGACY_DECLARE_ZOTO_PACK_IDS: readonly string[] = [];

/** Only `declare const zoto` is allowlisted (not `const zoto = getVizZoto()`). */
export const LEGACY_ZOTO_ALLOWLIST_RULES: ReadonlySet<PackLintRule> = new Set(["inline-zoto-declare"]);

export function packIdFromPluginsSrcPath(file: string): string | null {
  const m = file.match(/^plugins\/src\/([^/]+)\//);
  return m?.[1] ?? null;
}

export function isLegacyDeclareZotoPackAllowed(packId: string): boolean {
  return LEGACY_DECLARE_ZOTO_PACK_IDS.includes(packId);
}

/** `declare const zoto` on packs not on the pinned allowlist (always blocking). */
export function legacyZotoViolationsOnDisallowedPacks(violations: PackLintViolation[]): PackLintViolation[] {
  return violations.filter((v) => {
    if (!LEGACY_ZOTO_ALLOWLIST_RULES.has(v.rule)) return false;
    const packId = packIdFromPluginsSrcPath(v.file);
    return packId != null && !isLegacyDeclareZotoPackAllowed(packId);
  });
}
