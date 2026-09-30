/**
 * #180 tile-health confirm: a uniform five-patch verdict only stands if a coarse read of the tile's
 * sky alone (whole tile, no floor grid) is flat too.
 *
 * - nixie-clock (PA's real frame): all five patches land on dark wood, the tubes are lit; never flagged.
 * - tile-health-static with H1 applied (its uTime 0 / uBright 1 honoured): five patches read uniform
 *   (PA's no-clobber frame), the detailed sky is not flat; never flagged.
 * - tile-health-black: flat on both reads; still flagged (live-blank notice).
 * - tile-health-detail: never flagged; tile-health-stall: still climbs the ladder (drawing-nothing);
 *   tile-health-lose-ctx: context loss still wins over any confirm.
 *
 * Sky reads for the fixtures come from their own fragment.glsl, ported below, evaluated on the
 * camera's rays with the uniforms a real Backdrop holds after the pack's writes (H1 rule).
 *
 * Revert row: drop `skyFlat = confirm ?? undefined` in TileHealthMonitor.checkTile -> nixie and
 * static get the live-blank notice.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { TileHealthMonitor, type TileHealthDeps } from "./tile-health-monitor";
import {
  HEAL_LADDER,
  TILE_PATCH,
  TILE_SKY_CONFIRM_PX,
  classifyTileEmpty,
  healthPatchOrigins,
  patchesAreNearUniform,
  skyReadIsFlat,
  type TilePatchBytes,
} from "./tile-health";
import { NIXIE_FIVE_PATCH, NIXIE_TILE_64, STATIC_NOCLOB_FIVE_PATCH } from "./fixtures/tile-health-shots-180";
import { Backdrop } from "../graph/backdrop";
import type { NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";
import type { PluginView } from "./plugin";

const STEP_MS = 700;

function b64(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, "base64"));
}

type Vec3 = [number, number, number];
type Uniforms = { uTime: number; uBright: number; uAccent: Vec3; uBg: Vec3 };
type Shade = (dir: Vec3, u: Uniforms) => Vec3;

/** The five fixtures' sky/fragment.glsl, ported (camera-local ray `dir`, as the host dome gives). */
const SKY: Record<string, Shade> = {
  "tile-health-black": () => [0, 0, 0],
  "tile-health-detail": ([x, y, z], u) => {
    const n = Math.sin(40 * x + 37 * y) * Math.sin(22 * z + u.uTime);
    const v = 0.08 + 0.12 * (0.5 + 0.5 * n);
    return [v * 0.4 * u.uBright, v * 0.55 * u.uBright, v * 0.9 * u.uBright];
  },
  "tile-health-static": ([x, y], u) => {
    const n = Math.sin(30 * x) * Math.cos(25 * y);
    const v = 0.1 + 0.15 * (0.5 + 0.5 * n);
    return [v * 0.5 * u.uBright, v * 0.6 * u.uBright, v * u.uBright];
  },
  "tile-health-stall": ([x], u) => {
    const band = 0.5 + 0.5 * Math.sin(12 * x + u.uTime);
    return [0, 1, 2].map((i) => (u.uBg[i]! + (u.uAccent[i]! - u.uBg[i]!) * band) * u.uBright) as Vec3;
  },
  "tile-health-lose-ctx": ([, y], u) => {
    const v = 0.5 + 0.5 * Math.sin(10 * y + u.uTime * 0.8);
    return [0, 1, 2].map((i) => (u.uBg[i]! + (u.uAccent[i]! - u.uBg[i]!) * v) * u.uBright) as Vec3;
  },
};

/** What each fixture's frontend writes per frame (plugins/src/<id>/frontend/index.ts). */
const WRITES: Record<string, Array<[string, number | Vec3]>> = {
  "tile-health-black": [["uTime", 7.5], ["uBright", 1], ["uOpacity", 1]],
  "tile-health-detail": [["uTime", 7.5], ["uBright", 1], ["uAccent", [0.15, 0.35, 0.85]], ["uOpacity", 1]],
  "tile-health-static": [["uTime", 0], ["uBright", 1], ["uAccent", [0.2, 0.5, 0.8]], ["uOpacity", 1]],
  "tile-health-stall": [["uTime", 7.5], ["uBright", 0.9], ["uAccent", [0.2, 0.7, 0.95]], ["uOpacity", 0.85]],
  "tile-health-lose-ctx": [["uTime", 7.5], ["uBright", 0.85], ["uAccent", [0.9, 0.4, 0.2]], ["uOpacity", 0.9]],
};

/** The uniforms a real Backdrop holds after a host frame and the pack's own writes (H1). */
function packUniforms(packId: string): Uniforms {
  const sky = new Backdrop();
  sky.setViewport(1280, 800, 1);
  sky.setKind("plugin");
  expect(sky.setPluginShader({ id: packId, source: "void main() { fragColor = vec4(uBg * uBright, uOpacity); }" }, () => null)).toBeNull();
  sky.setLook(1, 0.92, 0.4);
  sky.setColors(0x2266cc, 0x0a0f1a);
  sky.tick(3);
  for (const [name, value] of WRITES[packId]!) sky.setPluginUniform(name, value);
  sky.tick(3.5);
  sky.setLook(1, 0.92, 0.4);
  const u = (sky.mesh.material as THREE.ShaderMaterial).uniforms;
  const c = (k: string): Vec3 => { const v = u[k]!.value as THREE.Color; return [v.r, v.g, v.b]; };
  return { uTime: u.uTime!.value as number, uBright: u.uBright!.value as number, uAccent: c("uAccent"), uBg: c("uBg") };
}

const W = 1280, H = 800, TAN = Math.tan((50 * Math.PI) / 360);

function ray(px: number, py: number, w: number, h: number): Vec3 {
  const x = ((px + 0.5) / w * 2 - 1) * TAN * (W / H);
  const y = ((py + 0.5) / h * 2 - 1) * TAN;
  const l = Math.hypot(x, y, 1);
  return [x / l, y / l, -1 / l];
}

function put(out: Uint8Array, o: number, c: Vec3): void {
  for (let i = 0; i < 3; i++) out[o + i] = Math.round(255 * Math.min(1, Math.max(0, c[i]!)));
  out[o + 3] = 255;
}

/** The five 16 px health patches of a full-canvas tile. */
function fivePatch(shade: Shade, u: Uniforms): TilePatchBytes {
  const chunk = TILE_PATCH * TILE_PATCH * 4;
  const out = new Uint8Array(chunk * 5);
  healthPatchOrigins({ x: 0, y: 0, w: W, h: H }).forEach((o, p) => {
    for (let j = 0; j < TILE_PATCH; j++) for (let i = 0; i < TILE_PATCH; i++) {
      put(out, p * chunk + (j * TILE_PATCH + i) * 4, shade(ray(o.x + i, o.y + j, W, H), u));
    }
  });
  return out;
}

/** The whole-tile confirm read: the sky alone at TILE_SKY_CONFIRM_PX² over the tile. */
function tileRead(shade: Shade, u: Uniforms): TilePatchBytes {
  const n = TILE_SKY_CONFIRM_PX;
  const out = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) put(out, (j * n + i) * 4, shade(ray(i, j, n, n), u));
  return out;
}

type Run = { heals: string[]; blanks: string[]; confirmCalls: number };

/** Monitor on a WebGL-shaped host: patches from `five`, the sky confirm from `tile` (async: pending first). */
function monitor(opts: {
  packId: string;
  five: TilePatchBytes;
  tile: TilePatchBytes | null;
  live: boolean;
  ms: number;
  mayBeStatic?: boolean;
  drawingNothing?: boolean;
  contextLost?: boolean;
  /** Not live on the sandbox floor, but new pictures keep landing (no viz.read, serial advances). */
  picturesAdvance?: boolean;
}): Run {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const heals: string[] = [];
  const blanks: string[] = [];
  let confirmCalls = 0;
  let pendingOnce = true;
  let serial = 1;
  const scene = {
    viewEl: document.createElement("div"),
    get pictureSerial() { return opts.picturesAdvance ? ++serial : serial; },
    gpuContextLost: !!opts.contextLost,
    lastViewport: { x: 0, y: 0, w: W, h: H },
    tileHealthSkyRgba: () => {
      confirmCalls++;
      if (!opts.tile) return null;
      if (pendingOnce) { pendingOnce = false; return "pending"; }
      return opts.tile;
    },
  } as unknown as NetScene;
  const deps: TileHealthDeps = {
    host: { software: false, gl: { isContextLost: () => false }, canvas: document.createElement("canvas"), pixelRatio: 1 } as unknown as RenderHost,
    mainScene: scene,
    mosaic: null,
    paneEl: () => scene.viewEl,
    sceneFor: () => scene,
    packFor: () => ({ id: opts.packId, capabilities: opts.picturesAdvance ? ["viz.write"] : ["viz.read", "viz.write"] } as PluginView),
    mayBeStatic: () => !!opts.mayBeStatic,
    awaitingApproval: () => false,
    isVisible: () => true,
    showErrors: () => false,
    tabVisible: () => true,
    onScreen: () => true,
    onHeal: (id, step) => { heals.push(`${id}:${step}`); },
    onLiveBlank: (id, p, on) => { blanks.push(`${id}:${p}:${on}`); },
    packLive: () => opts.live,
  };
  const mon = new TileHealthMonitor(deps);
  (mon as unknown as { sampleScene: () => TilePatchBytes }).sampleScene = () => opts.five;
  for (let t = 0; t < opts.ms; t += STEP_MS) {
    if (opts.live) mon.noteSandboxWrite();
    mon.noteVizFrameDelivered();
    if (opts.drawingNothing) mon.setPackDrawingNothing(true);
    mon.tick(t);
  }
  info.mockRestore();
  return { heals, blanks, confirmCalls };
}

describe("#180 tile-health confirm: nixie-clock (PA's frame at d276d5df)", () => {
  it("the false flag reproduces on the five patches alone, and the whole-tile read is not flat", () => {
    expect(patchesAreNearUniform(b64(NIXIE_FIVE_PATCH)), "five patches on dark wood").toBe(true);
    expect(skyReadIsFlat(b64(NIXIE_TILE_64)), "the lit tubes").toBe(false);
  });

  it("nixie-clock, drawing for 60 s: no live-blank notice, no heal", () => {
    const r = monitor({ packId: "nixie-clock", five: b64(NIXIE_FIVE_PATCH), tile: b64(NIXIE_TILE_64), live: true, ms: 60_000 });
    expect(r.confirmCalls, "the confirm ran").toBeGreaterThan(0);
    expect(r.blanks).toEqual([]);
    expect(r.heals).toEqual([]);
  });

  it("nixie-clock off the live floor (pictures still landing): the ladder does not climb", () => {
    const five = b64(NIXIE_FIVE_PATCH);
    const signals = { mayBeStatic: false, contextLost: false, pictureSerial: 2, dataFramesArriving: true, drawingNothing: false };
    expect(classifyTileEmpty({ patch: five, signals, lastCheckPictureSerial: 1 }), "five patches alone").toBe("uniform");
    expect(classifyTileEmpty({ patch: five, signals, lastCheckPictureSerial: 1, skyFlat: false })).toBeNull();
    const r = monitor({ packId: "nixie-clock", five, tile: b64(NIXIE_TILE_64), live: false, ms: 30_000, picturesAdvance: true });
    expect(r.confirmCalls).toBeGreaterThan(0);
    expect(r.heals).toEqual([]);
  });
});

describe("#180 tile-health confirm: the five fixtures, with H1 applied", () => {
  it("tile-health-static (uTime 0 / uBright 1 honoured): five patches uniform, sky not flat, never flagged", () => {
    const u = packUniforms("tile-health-static");
    expect(u.uTime, "H1: the pack's frozen clock").toBe(0);
    expect(u.uBright).toBeCloseTo(0.92, 9);
    expect(patchesAreNearUniform(b64(STATIC_NOCLOB_FIVE_PATCH)), "PA's no-clobber frame").toBe(true);
    const tile = tileRead(SKY["tile-health-static"]!, u);
    expect(skyReadIsFlat(tile)).toBe(false);
    const r = monitor({ packId: "tile-health-static", five: b64(STATIC_NOCLOB_FIVE_PATCH), tile, live: true, ms: 60_000, mayBeStatic: true });
    expect(r.confirmCalls).toBeGreaterThan(0);
    expect(r.blanks).toEqual([]);
    expect(r.heals).toEqual([]);
    const off = monitor({ packId: "tile-health-static", five: b64(STATIC_NOCLOB_FIVE_PATCH), tile, live: false, ms: 30_000, mayBeStatic: true, picturesAdvance: true });
    expect(off.heals, "off the live floor").toEqual([]);
  });

  it("tile-health-black: flat on the patches and on the whole tile, still gets the live-blank notice", () => {
    const u = packUniforms("tile-health-black");
    const five = fivePatch(SKY["tile-health-black"]!, u);
    const tile = tileRead(SKY["tile-health-black"]!, u);
    expect(patchesAreNearUniform(five)).toBe(true);
    expect(skyReadIsFlat(tile)).toBe(true);
    const r = monitor({ packId: "tile-health-black", five, tile, live: true, ms: 45_000 });
    expect(r.blanks).toEqual(["main:tile-health-black:true"]);
    expect(r.heals).toEqual([]);
  });

  it("tile-health-black off the live floor, pictures still landing: the ladder still heals it (uniform)", () => {
    const u = packUniforms("tile-health-black");
    const r = monitor({ packId: "tile-health-black", five: fivePatch(SKY["tile-health-black"]!, u), tile: tileRead(SKY["tile-health-black"]!, u), live: false, ms: 20_000, picturesAdvance: true });
    expect(r.confirmCalls).toBeGreaterThan(0);
    expect(r.heals[0]).toBe(`main:${HEAL_LADDER[0]}`);
  });

  it("tile-health-detail: never flagged", () => {
    const u = packUniforms("tile-health-detail");
    const five = fivePatch(SKY["tile-health-detail"]!, u);
    const tile = tileRead(SKY["tile-health-detail"]!, u);
    expect(skyReadIsFlat(tile)).toBe(false);
    const r = monitor({ packId: "tile-health-detail", five, tile, live: true, ms: 60_000 });
    expect(r.blanks).toEqual([]);
    expect(r.heals).toEqual([]);
  });

  it("tile-health-stall: after it stops writing, the ladder still climbs (drawing-nothing)", () => {
    const u = packUniforms("tile-health-stall");
    const five = fivePatch(SKY["tile-health-stall"]!, u);
    const tile = tileRead(SKY["tile-health-stall"]!, u);
    const r = monitor({ packId: "tile-health-stall", five, tile, live: false, ms: 20_000, drawingNothing: true });
    expect(r.heals[0]).toBe(`main:${HEAL_LADDER[0]}`);
    expect(r.blanks).toEqual([]);
  });

  it("tile-health-lose-ctx: a lost context is never overruled by the sky confirm", () => {
    const u = packUniforms("tile-health-lose-ctx");
    const five = fivePatch(SKY["tile-health-lose-ctx"]!, u);
    const signals = { mayBeStatic: false, contextLost: true, pictureSerial: 2, dataFramesArriving: true, drawingNothing: false };
    expect(classifyTileEmpty({ patch: five, signals, lastCheckPictureSerial: 1, skyFlat: false })).toBe("context-lost");
    const r = monitor({ packId: "tile-health-lose-ctx", five, tile: tileRead(SKY["tile-health-lose-ctx"]!, u), live: true, ms: 30_000, contextLost: true });
    expect(r.confirmCalls, "a lost tile is not sampled").toBe(0);
  });
});
