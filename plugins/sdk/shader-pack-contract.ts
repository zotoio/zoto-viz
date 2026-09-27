/**
 * Optional simple-view hook for shader plugin packs (host-side).
 * Packs declare `fallbackText` only when they implement it — no stubs required.
 */
export interface ShaderPack {
  fallbackText?: () => string | undefined;
}
