/**
 * #227: a pack tile whose own shader failed shows cant-draw (#171 c). showPickCouldntStart keeps
 * that on purpose, so the 216-b hand-off is a no-op there and, without a skip, every cycle went
 * resend-frame then a no-op cant-start. Health checks skip a cant-draw tile, the same way they skip
 * couldn't-start, and pick it up again once the state clears (its shader compiles or its pack is
 * updated). Counts only.
 */
import { afterEach, describe, expect, it } from "vitest";
import { TileHealthMonitor, type TileHealthDeps } from "./tile-health-monitor";
import { TILE_HEALTH_PATCHES, TILE_PATCH, tileCantDraw, type TilePatchBytes } from "./tile-health";
import type { NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";
import { viewMutAsDeviceRect } from "../graph/pack-mirror-rect";
import { mockPartial } from "../../test-support/mock-partial";
import type { PluginView } from "./plugin";
import {
  clearViewState,
  enterCantDrawShader,
  leaveCantDrawShader,
  onViewStateChange,
  setViewState,
  viewStateOf,
} from "../app/view-state";

const STEP_MS = 700;
/** The 216-b ladder window: past resend-frame and the couldn't-start hand-off. */
const WINDOW_MS = 180_000;
const PACK = "rocket-car-soccer";
const MODE = `plugin:${PACK}`;

/** Theme background with pitch-grid lines: not uniform, so the verdict is drawing-nothing. */
function gridPatch(): TilePatchBytes {
  const b = new Uint8Array(TILE_PATCH * TILE_PATCH * 4 * TILE_HEALTH_PATCHES);
  for (let i = 0; i < b.length; i += 4) {
    const v = (i / 4) % 8 === 0 ? 120 : 30;
    b[i] = v; b[i + 1] = v; b[i + 2] = v + 40; b[i + 3] = 255;
  }
  return b;
}

/** The main tile, wired like main.ts (view state for couldntStart / cantDraw, onCantStart true). */
function harness() {
  const scene = mockPartial<NetScene>({
    viewEl: document.createElement("div"),
    pictureSerial: 1,
    gpuContextLost: false,
    lastViewport: viewMutAsDeviceRect({ x: 0, y: 0, w: 200, h: 120 }),
  });
  const pack: PluginView = { id: PACK, name: "Rocket Car Soccer", version: 1, runtime: "typescript", capabilities: ["viz.read"] };
  const heals: string[] = [];
  const count = { heals, cantStart: 0, viewChanges: 0, fallback: 0 };
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
    onHeal: (id, step) => {
      heals.push(`${id}:${step}`);
      if (step === "fallback-pack") count.fallback++;
    },
    // main.ts: showPickCouldntStart, which leaves the pack's own cant-draw / shader in place.
    onCantStart: (id, packId) => {
      count.cantStart++;
      const cur = viewStateOf(id);
      if (!(cur?.kind === "cant-draw" && cur.reason === "shader" && cur.packId === packId)) {
        setViewState(id, MODE, { kind: "couldnt-start", reason: "load-failed", packId });
      }
      return true;
    },
    couldntStart: (id) => viewStateOf(id)?.kind === "couldnt-start",
    cantDraw: (id) => tileCantDraw(viewStateOf(id)),
    packLive: () => false,
  };
  const mon = new TileHealthMonitor(deps);
  Object.defineProperty(mon, "sampleScene", { value: () => gridPatch() });
  const stop = onViewStateChange((id) => { if (id === "main") count.viewChanges++; });
  let t = 0;
  /** Frames keep arriving; the pack never writes. */
  const run = (ms: number): void => {
    for (const end = t + ms; t < end; t += STEP_MS) {
      mon.noteVizFrameDelivered();
      mon.tick(t);
    }
  };
  return { count, run, dispose: () => { stop(); mon.dispose(); } };
}

describe("#227: health checks skip a tile in cant-draw", () => {
  afterEach(() => clearViewState("main"));

  it("pack shader failed (cant-draw): 0 heal steps and 0 view changes over the ladder window", () => {
    enterCantDrawShader("main", PACK, "ERROR: 0:1: syntax error");
    const h = harness();
    h.run(WINDOW_MS);
    h.dispose();
    expect(h.count.heals, "0 heal steps").toEqual([]);
    expect(h.count.cantStart, "0 couldn't-start hand-offs").toBe(0);
    expect(h.count.viewChanges, "0 view changes").toBe(0);
    expect(h.count.fallback, "never falls back to another view").toBe(0);
    expect(viewStateOf("main")?.kind, "still cant-draw").toBe("cant-draw");
  });

  it("cant-draw clears (shader compiles / pack updated): checks pick up again, one resend-frame then couldn't-start", () => {
    enterCantDrawShader("main", PACK);
    const h = harness();
    h.run(WINDOW_MS);
    expect(h.count.heals, "0 heal steps while cant-draw").toEqual([]);
    leaveCantDrawShader("main");
    h.run(WINDOW_MS);
    h.dispose();
    expect(h.count.heals, "one resend-frame once it can draw again").toEqual(["main:resend-frame"]);
    expect(h.count.cantStart).toBe(1);
    expect(viewStateOf("main")?.kind).toBe("couldnt-start");
    expect(h.count.fallback).toBe(0);
  });

  it("tileCantDraw: only the cant-draw kind", () => {
    expect(tileCantDraw({ kind: "cant-draw" })).toBe(true);
    expect(tileCantDraw({ kind: "couldnt-start" })).toBe(false);
    expect(tileCantDraw({ kind: "ready" })).toBe(false);
    expect(tileCantDraw(null)).toBe(false);
    expect(tileCantDraw(undefined)).toBe(false);
  });
});
