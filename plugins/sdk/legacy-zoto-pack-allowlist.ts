import type { PackLintRule, PackLintViolation } from "./pack-lint-types";

/** PR C (#55): all shipped packs use `getVizZoto()` — pinned allowlist removed. */
export const LEGACY_DECLARE_ZOTO_PACK_IDS: readonly string[] = [];

/** Only `declare const zoto` is allowlisted; `const zoto = getVizZoto()` uses pack-zoto-binding separately. */
export const LEGACY_ZOTO_ALLOWLIST_RULES: ReadonlySet<PackLintRule> = new Set(["inline-zoto-declare"]);

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
    if (!LEGACY_ZOTO_ALLOWLIST_RULES.has(v.rule)) return false;
    const packId = packIdFromPluginsSrcPath(v.file);
    return packId != null && !isLegacyDeclareZotoPackAllowed(packId);
  });
}
