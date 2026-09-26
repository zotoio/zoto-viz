import type { VizDataFrame } from "./viz-host";
import { buildVizFrameForPlugin } from "./viz-host";
import { buildIdleVizFrameFailed } from "./fixtures/idle-viz-frame";
import {
  buildVizSdkGoldenLiveFrame,
  buildVizSdkIdleFrame,
  buildVizSdkVmLiveFrame,
  emptyMonitorState,
  scrubMapForFrame,
  scrubVizDataFrame,
  VIZ_SDK_HOST_IDLE,
} from "./fixtures/viz-sdk-frame-build";

export const VIZ_DEV_FIXTURE_NAMES = ["idle", "idle-failed", "golden-live", "vm-live"] as const;
export type VizDevFixtureName = (typeof VIZ_DEV_FIXTURE_NAMES)[number];

const FIXTURE_SET = new Set<string>(VIZ_DEV_FIXTURE_NAMES);

export function isVizDevFixtureName(raw: string): raw is VizDevFixtureName {
  return FIXTURE_SET.has(raw);
}

/**
 * Parse `?vizFixture=` for the Vite dev server only. Pass `dev: false` in production
 * (import.meta.env.DEV is false there) so the param is always ignored.
 */
export function parseVizDevFixtureQuery(search: string, dev: boolean): VizDevFixtureName | null {
  if (!dev) return null;
  const q = search.startsWith("?") ? search.slice(1) : search;
  const raw = new URLSearchParams(q).get("vizFixture")?.trim();
  if (!raw) return null;
  if (isVizDevFixtureName(raw)) return raw;
  console.warn(`[zoto-viz] unknown vizFixture=${JSON.stringify(raw)} (ignored)`);
  return null;
}

function withClock(frame: VizDataFrame, t: number, dt: number, audio: number): VizDataFrame {
  return { ...frame, t, dt, audio: Math.min(1, Math.max(0, audio)) };
}

/** Build a shared SDK/dev fixture frame for plugin delivery (dev-only caller). */
export function buildVizDevFixtureFrame(
  name: VizDevFixtureName,
  t: number,
  dt: number,
  audio: number,
): VizDataFrame {
  switch (name) {
    case "idle": {
      const state = emptyMonitorState(t);
      const raw = buildVizFrameForPlugin(state, t - dt, audio, VIZ_SDK_HOST_IDLE);
      return withClock(scrubVizDataFrame(raw, scrubMapForFrame(state, raw)), t, dt, audio);
    }
    case "idle-failed":
      return withClock(buildIdleVizFrameFailed(t, dt), t, dt, audio);
    case "golden-live":
      return withClock(buildVizSdkGoldenLiveFrame(), t, dt, audio);
    case "vm-live":
      return withClock(buildVizSdkVmLiveFrame(), t, dt, audio);
    default:
      return withClock(buildVizSdkIdleFrame(), t, dt, audio);
  }
}
