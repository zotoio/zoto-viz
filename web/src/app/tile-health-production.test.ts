import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindTileHealthPresentTick } from "./tile-health-present";
import { createProductionTileHealthMonitor } from "./tile-health-boot";
import {
  TILE_CHECK_MS,
  TILE_EMPTY_STREAK,
  type TilePatchBytes,
} from "../plugins/tile-health";
import { readTileHealErrors, writeTileHealErrors } from "../plugins/tile-health-monitor";
import type { NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";

function rgbaFill(r: number, g: number, b: number): TilePatchBytes {
  const out = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function noisyPatch(): TilePatchBytes {
  const out = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) {
    const v = (i * 37 + (i % 5) * 11) % 40;
    out[i * 4] = 8 + v;
    out[i * 4 + 1] = 12 + v;
    out[i * 4 + 2] = 18 + v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function productionHarness(over: {
  patch?: TilePatchBytes | null;
  pictureSerial?: number;
  contextLost?: boolean;
  showErrors?: () => boolean;
} = {}) {
  let serial = over.pictureSerial ?? 0;
  const patch = over.patch !== undefined ? over.patch : noisyPatch();
  const scene = {
    viewEl: document.createElement("div"),
    get pictureSerial() { return serial; },
    set pictureSerial(v: number) { serial = v; },
    gpuContextLost: over.contextLost ?? false,
    lastViewport: { x: 0, y: 0, w: 200, h: 120 },
    tileHealthRgba: () => (patch === null ? null : patch),
  } as NetScene;
  const host = {
    software: false,
    canvas: document.createElement("canvas"),
    pixelRatio: 1,
    gl: { isContextLost: () => false } as WebGL2RenderingContext,
  } as RenderHost;
  const heals: string[] = [];
  const listeners: Array<(ts: number) => void> = [];
  const mon = createProductionTileHealthMonitor({
    host,
    mainScene: scene,
    mosaic: null,
    paneEl: () => scene.viewEl,
    sceneFor: () => scene,
    packFor: () => null,
    mayBeStatic: () => false,
    awaitingApproval: () => false,
    isVisible: () => true,
    showErrors: over.showErrors ?? (() => readTileHealErrors()),
    onHeal: (_id, step) => { heals.push(step); },
    tabVisible: () => true,
    onScreen: () => true,
  });
  bindTileHealthPresentTick(mon, (fn) => { listeners.push(fn); });
  const tickPresent = (ts: number) => { for (const fn of listeners) fn(ts); };
  mon.noteVizFrameDelivered();
  mon.noteGrace("main", 0);
  return { mon, heals, scene, tickPresent };
}

describe("tile health production wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeTileHealErrors(false);
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    writeTileHealErrors(false);
  });

  it("blank tile for TILE_EMPTY_STREAK checks triggers exactly one heal", () => {
    const { heals, tickPresent } = productionHarness({ patch: rgbaFill(0, 0, 0) });
    const step = TILE_CHECK_MS / 1;
    let t = 10_000;
    for (let i = 0; i < TILE_EMPTY_STREAK; i++) {
      t += step;
      tickPresent(t);
    }
    expect(heals).toEqual(["resend-frame"]);
  });

  it("healthy tile over 600 present ticks produces zero heals", () => {
    const { heals, scene, tickPresent } = productionHarness({ patch: noisyPatch() });
    let t = 20_000;
    for (let i = 0; i < 600; i++) {
      scene.pictureSerial = i + 1;
      t += 16;
      tickPresent(t);
    }
    expect(heals).toHaveLength(0);
  });

  it("pending PBO read (tileHealthRgba null) does not advance empty streak", () => {
    const { heals, tickPresent, mon } = productionHarness({ patch: null });
    let t = 30_000;
    for (let i = 0; i < 8; i++) {
      t += TILE_CHECK_MS;
      tickPresent(t);
    }
    expect(heals).toHaveLength(0);
    expect(mon.state("main").emptyStreak).toBe(0);
  });

  it("context lost produces zero heals until restored", () => {
    const { heals, scene, tickPresent } = productionHarness({
      patch: rgbaFill(0, 0, 0),
      contextLost: true,
    });
    let t = 40_000;
    for (let i = 0; i < TILE_EMPTY_STREAK + 2; i++) {
      t += TILE_CHECK_MS;
      tickPresent(t);
    }
    expect(heals).toHaveLength(0);
    scene.gpuContextLost = false;
    for (let i = 0; i < TILE_EMPTY_STREAK; i++) {
      t += TILE_CHECK_MS;
      tickPresent(t);
    }
    expect(heals).toEqual(["resend-frame"]);
  });

  it("with tile heal errors setting off, heal labels stay hidden", () => {
    writeTileHealErrors(false);
    const { mon, scene } = productionHarness({ showErrors: () => false });
    const state = mon.state("main");
    state.lastMessage = "Tile blank for 6 s, restarted pack";
    (mon as unknown as { paintLabel: (id: string, s: typeof state) => void }).paintLabel("main", state);
    const label = scene.viewEl.querySelector(".tile-heal-msg") as HTMLElement;
    expect(label.textContent).toBe("");
    expect(label.hasAttribute("hidden") || label.hidden).toBe(true);
  });
});
