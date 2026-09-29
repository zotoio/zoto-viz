import { describe, expect, it, vi } from "vitest";
import { TileHealthMonitor, type TileHealthDeps } from "./tile-health-monitor";
import { TILE_CHECK_MS, TILE_HEALTH_PATCHES, TilePatchSampler } from "./tile-health";
import { LumaProbe } from "../graph/lumaProbe";
import type { NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";
import type { PluginView } from "./plugin";

/** Value checks only (no timing): how many readbacks the five-patch health sampler issues. */
function fakeGl() {
  const readPixels = vi.fn();
  const gl = {
    TIMEOUT_EXPIRED: 0x911c,
    WAIT_FAILED: 0x911d,
    PIXEL_PACK_BUFFER: 0x88eb,
    drawingBufferWidth: 800,
    drawingBufferHeight: 480,
    isContextLost: () => false,
    createBuffer: () => ({}),
    deleteBuffer: vi.fn(),
    bufferData: vi.fn(),
    bindBuffer: vi.fn(),
    readPixels,
    fenceSync: vi.fn(() => ({})),
    clientWaitSync: vi.fn(() => 0x911a), // already signalled: harvest on the next call
    deleteSync: vi.fn(),
    getBufferSubData: vi.fn(),
    flush: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  return { gl, readPixels };
}

function monitorOver(tiles: string[]) {
  const { gl, readPixels } = fakeGl();
  const probes = new Map<string, LumaProbe>();
  const sceneFor = (id: string) => {
    const probe = probes.get(id) ?? new LumaProbe(16, 60_000);
    probes.set(id, probe);
    return {
      viewEl: document.createElement("div"),
      pictureSerial: 1,
      gpuContextLost: false,
      lastViewport: { x: 0, y: 0, w: 400, h: 240 },
      tileHealthRgba: (g: WebGL2RenderingContext, now: number) =>
        probe.sampleForHealth(g, { x: 0, y: 0, w: 400, h: 240 }, now),
    } as unknown as NetScene;
  };
  const deps: TileHealthDeps = {
    host: { software: false, gl, canvas: document.createElement("canvas"), pixelRatio: 1 } as unknown as RenderHost,
    mainScene: sceneFor("main"),
    mosaic: tiles.length > 1 ? ({ on: true, tileIds: tiles } as unknown as TileHealthDeps["mosaic"]) : null,
    paneEl: () => null,
    sceneFor,
    packFor: (id) => ({ id } as PluginView),
    mayBeStatic: () => false,
    awaitingApproval: () => false,
    isVisible: () => true,
    showErrors: () => false,
    tabVisible: () => true,
    onScreen: () => true,
    onHeal: () => {},
  };
  return { mon: new TileHealthMonitor(deps), readPixels };
}

describe("five-patch health sampler: readback count and allocation", () => {
  it("600 frames with one sample due issue exactly 5 readbacks (heal timer, not per frame)", () => {
    const { mon, readPixels } = monitorOver(["main"]);
    const base = performance.now() + TILE_CHECK_MS * 10; // past the first check interval
    for (let f = 0; f < 600; f++) mon.tick(base + f); // 600 ms of frames < one TILE_CHECK_MS
    expect(readPixels).toHaveBeenCalledTimes(TILE_HEALTH_PATCHES);
  });

  it("2x2 mosaic: at most 5 readbacks per tile per check window, one tile checked per stagger slot", () => {
    const tiles = ["a", "b", "c", "d"];
    const { mon, readPixels } = monitorOver(tiles);
    const base = performance.now() + TILE_CHECK_MS * 10;
    for (let f = 0; f < 600; f++) mon.tick(base + f * (TILE_CHECK_MS / 600)); // one full window
    // 4 stagger slots in one window → each tile sampled once → 4 × 5 reads, not 600 × anything.
    expect(readPixels.mock.calls.length).toBe(tiles.length * TILE_HEALTH_PATCHES);
  });

  it("GL path returns the same buffer instance on the first and the hundredth sample", () => {
    const { gl } = fakeGl();
    const probe = new LumaProbe(16, 60_000);
    const vp = { x: 0, y: 0, w: 400, h: 240 };
    let first: Uint8Array | null = null;
    let samples = 0;
    for (let i = 0; i < 100; i++) {
      // Stale → queue five reads (null), then harvest them → the joined five-patch buffer.
      expect(probe.sampleForHealth(gl, vp, performance.now() + 4000)).toBeNull();
      const b = probe.sampleForHealth(gl, vp, performance.now());
      expect(b).not.toBeNull();
      first ??= b;
      expect(b).toBe(first);
      samples++;
    }
    expect(samples).toBe(100);
  });

  it("software path returns the same buffer instance on the first and the hundredth sample", () => {
    const sampler = new TilePatchSampler();
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16 * 16 * 4) })),
    };
    (sampler as unknown as { ctx: unknown }).ctx = ctx;
    const origins = Array.from({ length: TILE_HEALTH_PATCHES }, (_, i) => ({ x: i * 20, y: i * 10 }));
    const first = sampler.sampleMulti2d(document.createElement("canvas"), origins, 16);
    for (let i = 0; i < 99; i++) expect(sampler.sampleMulti2d(document.createElement("canvas"), origins, 16)).toBe(first);
    expect(ctx.drawImage).toHaveBeenCalledTimes(100 * TILE_HEALTH_PATCHES);
  });
});
