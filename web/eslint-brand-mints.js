/**
 * Branded time/space scalars: `as Brand` only in each brand's mint module (and *.test.ts).
 * Other PRs extend this list (CssRect, DeviceRect, GlRect, DevicePxRatio, …).
 */
export const BRAND_MINTS = [
  { brand: "FrameTs", file: "src/core/time-ms.ts", mint: "frameTsFromRaf()" },
  { brand: "MonoMs", file: "src/core/time-ms.ts", mint: "monoMs()" },
  // #52 viz-clock (mint helpers land in time-ms.ts with these brands)
  { brand: "WallMs", file: "src/core/time-ms.ts", mint: "wallMs()" },
  { brand: "EpochSec", file: "src/core/time-ms.ts", mint: "epochSec()" },
];

/** Flat-config ignore globs: all mint modules + tests. */
export function brandMintIgnoreGlobs() {
  return ["dist/**", "**/*.test.ts", ...new Set(BRAND_MINTS.map((b) => b.file))];
}

/** `no-restricted-syntax` selectors for production TS. */
export function brandCastSyntaxRules() {
  return BRAND_MINTS.map((b) => ({
    selector: `TSAsExpression[typeAnnotation.typeName.name="${b.brand}"]`,
    message: `Do not cast to ${b.brand}; mint only via ${b.mint} in ${b.file}.`,
  }));
}
