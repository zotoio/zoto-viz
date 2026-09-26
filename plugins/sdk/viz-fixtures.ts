/**
 * Host-frozen VizDataFrame fixtures for pack light tests.
 * Regenerate frames: `FREEZE_VIZ_FIXTURES=1 pnpm exec vitest run src/plugins/fixtures/viz-sdk-fixtures.freeze.test.ts` in `web/`.
 * Refresh `vm-live-state.json`: run monitor ~45s, then `IMPORT_VM_LIVE_RAW=/path/to/state.json pnpm exec vitest run src/plugins/fixtures/viz-vm-live-capture.test.ts -t import` (or `CAPTURE_VM_LIVE=1` against a live :7020).
 */

import type { VizDataFrame } from "./viz-contract";
import fatLiveFailed from "./fixtures/fat-live-failed.json";
import fatLive from "./fixtures/fat-live.json";
import goldenLiveFailed from "./fixtures/golden-live-failed.json";
import goldenLive from "./fixtures/golden-live.json";
import idle from "./fixtures/idle.json";
import vmLive from "./fixtures/vm-live.json";

export const VIZ_FIXTURE_IDLE = idle as VizDataFrame;
export const VIZ_FIXTURE_GOLDEN_LIVE = goldenLive as VizDataFrame;
export const VIZ_FIXTURE_GOLDEN_LIVE_FAILED = goldenLiveFailed as VizDataFrame;
export const VIZ_FIXTURE_FAT_LIVE = fatLive as VizDataFrame;
export const VIZ_FIXTURE_FAT_LIVE_FAILED = fatLiveFailed as VizDataFrame;
export const VIZ_FIXTURE_VM_LIVE = vmLive as VizDataFrame;

export const VIZ_FIXTURES = {
  idle: VIZ_FIXTURE_IDLE,
  "golden-live": VIZ_FIXTURE_GOLDEN_LIVE,
  "golden-live-failed": VIZ_FIXTURE_GOLDEN_LIVE_FAILED,
  "fat-live": VIZ_FIXTURE_FAT_LIVE,
  "fat-live-failed": VIZ_FIXTURE_FAT_LIVE_FAILED,
  "vm-live": VIZ_FIXTURE_VM_LIVE,
} as const;

export type VizFixtureName = keyof typeof VIZ_FIXTURES;

export const VIZ_FIXTURE_NAMES = Object.keys(VIZ_FIXTURES) as VizFixtureName[];

/** Default pack smoke set: synthetic idle, golden seed LAN, and quiet VM capture. */
export const VIZ_FIXTURE_PACK_DEFAULT: VizFixtureName[] = ["idle", "golden-live", "vm-live"];

/** Run a pack `onFrame` handler across shared fixtures (defaults to idle + golden-live). */
export function runPackOnFixtures(
  onFrame: (frame: VizDataFrame) => void,
  names: readonly VizFixtureName[] = VIZ_FIXTURE_PACK_DEFAULT,
): void {
  for (const name of names) onFrame(VIZ_FIXTURES[name]);
}
