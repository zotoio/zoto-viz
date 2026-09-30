/**
 * #216: a pack tile still drawing nothing after the one tile-heal resend-frame (frames delivered,
 * the pack never writes, the picture is not uniform: theme background plus pitch grid) shows the
 * existing "Rocket Car Soccer couldn't start." with Retry and stays on the pack. The ladder never
 * goes on to restart-pack / recreate-context / demo-snapshot / fallback-pack (Topology).
 */
import { describe, expect, it } from "vitest";
import { TileHealthMonitor, type TileHealthDeps } from "./tile-health-monitor";
import { TILE_HEAL_FALLBACK_MODE, TILE_HEALTH_PATCHES, TILE_PATCH, type TilePatchBytes } from "./tile-health";
import type { NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";
import { viewMutAsDeviceRect } from "../graph/pack-mirror-rect";
import { mockPartial } from "../../test-support/mock-partial";
import type { PluginView } from "./plugin";

const RCS_MODE = "plugin:rocket-car-soccer";
const CANT_START = "cant-start:main:rocket-car-soccer";
const STEP_MS = 700;

/** Theme background with pitch-grid lines: not uniform, so the verdict is drawing-nothing. */
function gridPatch(): TilePatchBytes {
  const b = new Uint8Array(TILE_PATCH * TILE_PATCH * 4 * TILE_HEALTH_PATCHES);
  for (let i = 0; i < b.length; i += 4) {
    const v = (i / 4) % 8 === 0 ? 120 : 30;
    b[i] = v; b[i + 1] = v; b[i + 2] = v + 40; b[i + 3] = 255;
  }
  return b;
}

/**
 * Rocket Car Soccer on the main tile, wired like main.ts: fallback-pack is applyMode(Topology);
 * onCantStart shows the pack's couldn't-start, after which the tile reads couldnt-start until
 * Retry re-applies the mode.
 */
function harness() {
  const scene = mockPartial<NetScene>({
    viewEl: document.createElement("div"),
    pictureSerial: 1,
    gpuContextLost: false,
    lastViewport: viewMutAsDeviceRect({ x: 0, y: 0, w: 200, h: 120 }),
  });
  const rcs: PluginView = {
    id: "rocket-car-soccer",
    name: "Rocket Car Soccer",
    version: 1,
    runtime: "typescript",
    capabilities: ["viz.read", "viz.write"],
  };
  const events: string[] = [];
  const h = { mode: RCS_MODE, couldntStart: false, samples: 0, events };
  const deps: TileHealthDeps = {
    host: mockPartial<RenderHost>({ software: true, canvas: document.createElement("canvas"), pixelRatio: 1, gl: null }),
    mainScene: scene,
    mosaic: null,
    paneEl: () => scene.viewEl,
    sceneFor: () => scene,
    packFor: () => rcs,
    mayBeStatic: () => false,
    awaitingApproval: () => false,
    isVisible: () => true,
    showErrors: () => false,
    tabVisible: () => true,
    onScreen: () => true,
    onHeal: (id, step) => {
      h.events.push(`${id}:${step}`);
      if (step === "fallback-pack") h.mode = TILE_HEAL_FALLBACK_MODE;
    },
    onCantStart: (id, packId) => {
      h.events.push(`cant-start:${id}:${packId}`);
      h.couldntStart = true;
      return true;
    },
    couldntStart: () => h.couldntStart,
    packLive: () => false,
  };
  const mon = new TileHealthMonitor(deps);
  Object.defineProperty(mon, "sampleScene", { value: () => { h.samples++; return gridPatch(); } });
  /** Frames keep arriving, the pack never writes. */
  const run = (from: number, to: number): number => {
    let t = from;
    for (; t < to; t += STEP_MS) {
      mon.noteVizFrameDelivered();
      mon.tick(t);
    }
    return t;
  };
  /** Retry: the mode is re-applied (load grace), so the tile no longer reads couldnt-start. */
  const retry = (now: number): void => {
    h.couldntStart = false;
    mon.noteGrace("main", now);
  };
  return { h, mon, run, retry };
}

describe("#216: drawing nothing after resend-frame shows couldn't-start and stays on the pack", () => {
  it("Rocket Car Soccer on main: one resend-frame, then couldn't-start once; no restart-pack, no fallback to Topology", () => {
    const { h, mon, run } = harness();
    run(0, 180_000);
    mon.dispose();

    const heals = h.events.filter((e) => e.startsWith("main:"));
    expect(heals.filter((e) => e === "main:resend-frame").length, "one resend-frame").toBe(1);
    expect(heals.filter((e) => e !== "main:resend-frame"), "no later heal step").toEqual([]);
    expect(h.events.filter((e) => e === CANT_START), "the existing couldn't-start, once, on the pack").toEqual([CANT_START]);
    expect(h.mode, "no applyMode / fallback: the view stays on the pack").toBe(RCS_MODE);
  });

  it("Retry while still drawing nothing: one more resend-frame, then couldn't-start again; no check while couldn't-start; never Topology", () => {
    const { h, mon, run, retry } = harness();
    let t = run(0, 60_000);
    expect(h.events, "first attempt: one resend-frame, then couldn't-start").toEqual(["main:resend-frame", CANT_START]);

    const samplesAtNotice = h.samples;
    t = run(t, 120_000);
    expect(h.samples - samplesAtNotice, "no tile check while the tile reads couldnt-start").toBe(0);
    expect(h.events, "no heal step while the tile reads couldnt-start").toEqual(["main:resend-frame", CANT_START]);

    retry(t);
    run(t, 300_000);
    mon.dispose();

    expect(h.events, "Retry: exactly one more resend-frame, then couldn't-start again (one resend per attempt)").toEqual([
      "main:resend-frame", CANT_START, "main:resend-frame", CANT_START,
    ]);
    expect(h.events.filter((e) => e === CANT_START).length, "couldn't-start twice in total").toBe(2);
    expect(h.events.filter((e) => /:(restart-pack|recreate-context|demo-snapshot|fallback-pack)$/.test(e)), "never a later ladder step").toEqual([]);
    expect(h.mode, "never switched to plugin:topology").toBe(RCS_MODE);
  });
});
