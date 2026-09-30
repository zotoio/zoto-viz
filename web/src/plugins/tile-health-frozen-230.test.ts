/**
 * #230: sky speed 0 (the sky's clock stops) and paused feeds (`live.paused`) freeze a tile's
 * picture on purpose. The stalled check skips such a tile, so over the ladder window it gives
 * 0 couldn't-start notices and 0 heal steps, and it judges the tile again once either is undone.
 * Control: normal speed, feeds running, the same frozen frame is flagged (resend-frame, then the
 * pack's couldn't-start, as #216).
 */
import { describe, expect, it } from "vitest";
import { TileHealthMonitor, type TileHealthDeps } from "./tile-health-monitor";
import {
  TILE_CHECK_MS,
  TILE_EMPTY_STREAK,
  TILE_HEALTH_PATCHES,
  TILE_LOAD_GRACE_MS,
  TILE_PATCH,
  tileFeedsPaused,
  type TilePatchBytes,
} from "./tile-health";
import type { DreamAnim, NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";
import type { SourceLive } from "../core/sources";
import { viewMutAsDeviceRect } from "../graph/pack-mirror-rect";
import { mockPartial } from "../../test-support/mock-partial";
import type { PluginView } from "./plugin";

const STEP_MS = 700;
/** Past the control's resend-frame and couldn't-start (the #216 ladder window). */
const WINDOW_MS = 120_000;

/**
 * From the unpause: the normal load grace, then the empty streak it takes to heal. Without the
 * grace a stalled tile would already heal inside this window (its streak starts at the unpause).
 */
const RESUME_GRACE_WINDOW_MS = TILE_LOAD_GRACE_MS + (TILE_EMPTY_STREAK - 1) * TILE_CHECK_MS;

/** A detailed picture (not uniform) that never changes: pictureSerial below never advances. */
function stillPatch(): TilePatchBytes {
  const b = new Uint8Array(TILE_PATCH * TILE_PATCH * 4 * TILE_HEALTH_PATCHES);
  for (let i = 0; i < b.length; i += 4) {
    const v = (i / 4) % 8 === 0 ? 120 : 30;
    b[i] = v; b[i + 1] = v; b[i + 2] = v + 40; b[i + 3] = 255;
  }
  return b;
}

function harness(opts: { skySpeed: number; paused: boolean }) {
  const anim = mockPartial<DreamAnim>({ skySpeed: opts.skySpeed });
  const scene = mockPartial<NetScene>({
    viewEl: document.createElement("div"),
    pictureSerial: 1,
    gpuContextLost: false,
    lastViewport: viewMutAsDeviceRect({ x: 0, y: 0, w: 200, h: 120 }),
    dreamAnim: anim,
  });
  const feed: SourceLive = { id: "news", kind: "rss", label: "News", ok: true, paused: opts.paused };
  const sources: Record<string, SourceLive> = { news: feed };
  const pack: PluginView = { id: "orbits", name: "Orbits", version: 1, runtime: "typescript", capabilities: ["viz.read"] };
  const heals: string[] = [];
  const count = { checks: 0, notices: 0, heals };
  let couldntStart = false;
  const deps: TileHealthDeps = {
    host: mockPartial<RenderHost>({ software: true, canvas: document.createElement("canvas"), pixelRatio: 1, gl: null }),
    mainScene: scene,
    mosaic: null,
    paneEl: () => scene.viewEl,
    sceneFor: () => scene,
    packFor: () => pack,
    mayBeStatic: () => false,
    awaitingApproval: () => false,
    isVisible: () => true,
    showErrors: () => false,
    tabVisible: () => true,
    onScreen: () => true,
    onHeal: (id, step) => { count.heals.push(`${id}:${step}`); },
    onCantStart: () => { count.notices++; couldntStart = true; return true; },
    couldntStart: () => couldntStart,
    // main.ts: the tile's bound source (none here, so every source) from the last state message.
    feedsPaused: () => tileFeedsPaused(sources, undefined),
    packLive: () => false,
  };
  const mon = new TileHealthMonitor(deps);
  Object.defineProperty(mon, "sampleScene", { value: () => { count.checks++; return stillPatch(); } });
  let t = 0;
  /** Frames keep arriving and the pack writes each one (so not drawing-nothing); the picture holds. */
  const run = (ms: number): void => {
    for (const end = t + ms; t < end; t += STEP_MS) {
      mon.noteVizFrameDelivered();
      mon.noteVizWrite();
      mon.tick(t);
    }
  };
  return { anim, feed, count, run, dispose: () => mon.dispose() };
}

describe("#230: the stalled check skips a tile frozen on purpose (sky speed 0, paused feeds)", () => {
  it("control: normal sky speed, feeds running, frozen frame: flagged (one resend-frame, one couldn't-start)", () => {
    const h = harness({ skySpeed: 1, paused: false });
    h.run(WINDOW_MS);
    h.dispose();
    expect(h.count.heals).toEqual(["main:resend-frame"]);
    expect(h.count.notices).toBe(1);
  });

  it("sky speed 0: 0 notices and 0 heal steps over the window; judged again once the speed is back", () => {
    const h = harness({ skySpeed: 0, paused: false });
    h.run(WINDOW_MS);
    expect(h.count.notices, "0 couldn't-start notices").toBe(0);
    expect(h.count.heals, "0 heal steps").toEqual([]);
    expect(h.count.checks, "the tile was checked").toBeGreaterThan(10);
    h.anim.skySpeed = 1;
    h.run(WINDOW_MS);
    h.dispose();
    expect(h.count.heals, "resumes: flagged once the speed is back").toEqual(["main:resend-frame"]);
    expect(h.count.notices).toBe(1);
  });

  it("feeds paused: 0 notices and 0 heal steps over the window; judged again once the feeds resume", () => {
    const h = harness({ skySpeed: 1, paused: true });
    h.run(WINDOW_MS);
    expect(h.count.notices, "0 couldn't-start notices").toBe(0);
    expect(h.count.heals, "0 heal steps").toEqual([]);
    expect(h.count.checks, "the tile was checked").toBeGreaterThan(10);
    h.feed.paused = false;
    h.run(WINDOW_MS);
    h.dispose();
    expect(h.count.heals, "resumes: flagged once the feeds resume").toEqual(["main:resend-frame"]);
    expect(h.count.notices).toBe(1);
  });

  for (const undo of ["sky speed back above 0", "feeds resume"] as const) {
    it(`${undo}: the normal load grace first (0 notices, 0 heal steps), then a still-frozen frame flags as normal`, () => {
      const h = harness({ skySpeed: undo === "feeds resume" ? 1 : 0, paused: undo === "feeds resume" });
      h.run(WINDOW_MS);
      expect(h.count.heals, "frozen on purpose: 0 heal steps").toEqual([]);
      if (undo === "feeds resume") h.feed.paused = false;
      else h.anim.skySpeed = 1;
      h.run(RESUME_GRACE_WINDOW_MS);
      expect(h.count.notices, "grace after the unpause: 0 couldn't-start notices").toBe(0);
      expect(h.count.heals, "grace after the unpause: 0 heal steps").toEqual([]);
      h.run(WINDOW_MS);
      h.dispose();
      expect(h.count.heals, "after the grace: flagged as normal").toEqual(["main:resend-frame"]);
      expect(h.count.notices).toBe(1);
    });
  }

  it("tileFeedsPaused: the bound source decides; unbound, every source must be paused", () => {
    const a: SourceLive = { id: "a", kind: "rss", label: "A", ok: true, paused: true };
    const b: SourceLive = { id: "b", kind: "rss", label: "B", ok: true };
    expect(tileFeedsPaused({ a, b }, "a")).toBe(true);
    expect(tileFeedsPaused({ a, b }, "b")).toBe(false);
    expect(tileFeedsPaused({ a, b }, undefined)).toBe(false);
    expect(tileFeedsPaused({ a }, undefined)).toBe(true);
    expect(tileFeedsPaused({}, undefined)).toBe(false);
    expect(tileFeedsPaused(undefined, "a")).toBe(false);
  });
});
