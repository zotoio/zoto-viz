import type { PackLintRule, PackLintViolation } from "./pack-lint-types";

/**
 * Shipped packs still on `declare const zoto` until PR C (#55) migrates them to `getVizZoto()`.
 * Only ids on this list may carry baselined `inline-zoto-declare` rows; any other pack fails.
 */
export const LEGACY_DECLARE_ZOTO_PACK_IDS: readonly string[] = [
  "ant-colony",
  "aquarium",
  "backrooms",
  "blob-mesh",
  "cypher-cic",
  "hn-rain",
  "hn-term",
  "kefrens-bars",
  "koi-pond",
  "lan-pulse",
  "marble-run",
  "metro-lines",
  "nixie-clock",
  "packet-tunnel",
  "pulse-ts",
  "rf-constellation",
  "rocket-car-soccer",
  "roto-proto",
  "star-sines",
  "stereo-gram",
  "syscon",
  "talker-storm",
  "voxel-world",
];

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
