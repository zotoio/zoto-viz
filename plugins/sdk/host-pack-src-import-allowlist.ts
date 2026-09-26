/**
 * Host code (`web/src/**`, `service/**`) must not import `plugins/src/**`.
 * Each id here is existing debt on main; remove entries only after host imports are gone.
 */
export const HOST_PACK_SRC_IMPORT_ALLOWLIST: readonly string[] = [
  "backrooms", // debt: web/src/app/main.ts, web/src/audio/plugin-sfx.ts, host tests
  "hn-rain", // debt: web/src/app/main.ts, hn-rain-stills.ts, viz-pack-host.ts
  "hn-term", // debt: web/src/plugins/viz-pack-host.ts
  "marble-run", // debt: web/src/plugins/marble-run.test.ts (tests excluded from guard; pack used in host fixtures)
  "nixie-clock", // debt: web/src/plugins/viz-pack-host.ts
  "packet-tunnel", // debt: web/src/plugins/viz-pack-host.ts, dogfood tests
  "stereo-gram", // debt: web/src/app/main.ts, stereo-ai.ts, viz-pack-host.ts
];

export const HOST_PACK_SRC_IMPORT_ALLOWLIST_COUNT = HOST_PACK_SRC_IMPORT_ALLOWLIST.length;

export function packIdFromPluginsSrcTarget(target: string): string | null {
  const m = target.match(/^plugins\/src\/([^/]+)\//);
  return m?.[1] ?? null;
}

export function isHostPackSrcImportAllowlisted(packId: string): boolean {
  return HOST_PACK_SRC_IMPORT_ALLOWLIST.includes(packId);
}
