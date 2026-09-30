import { describe, expect, it, vi } from "vitest";
import { TileHealthMonitor, type TileHealthDeps } from "./tile-health-monitor";
import {
  HEAL_LADDER,
  TILE_CHECK_MS,
  TILE_HEALTH_PATCHES,
  TILE_PATCH,
  freshTileHealthState,
  patchIsNearUniform,
  patchesAreNearUniform,
  type TilePatchBytes,
} from "./tile-health";
import type { NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";
import { viewMutAsDeviceRect } from "../graph/pack-mirror-rect";
import { mockPartial } from "../../test-support/mock-partial";
import type { PluginView } from "./plugin";

const CHECK_STEP_MS = 700;

type Kind = "noisy" | "black" | "koi" | "black5" | "tones5";

/** Koi-like five-patch read: flat water in the centre, fish (detail) in every quadrant. */
function fivePatch(kind: "koi" | "black5" | "tones5"): TilePatchBytes {
  const chunk = TILE_PATCH * TILE_PATCH * 4;
  const b = new Uint8Array(chunk * TILE_HEALTH_PATCHES);
  for (let p = 0; p < TILE_HEALTH_PATCHES; p++) {
    for (let i = 0; i < chunk; i += 4) {
      let v = 0;
      if (kind === "koi") v = p === 0 ? 40 : (i * 37) % 255;
      if (kind === "tones5") v = 20 + p * 30; // each patch flat, but different from the others
      b[p * chunk + i] = v;
      b[p * chunk + i + 1] = v;
      b[p * chunk + i + 2] = kind === "koi" && p === 0 ? 90 : v;
      b[p * chunk + i + 3] = 255;
    }
  }
  return b;
}

function patch(kind: Kind): TilePatchBytes {
  if (kind === "koi" || kind === "black5" || kind === "tones5") return fivePatch(kind);
  const n = TILE_PATCH * TILE_PATCH * 4;
  const b = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i += 4) {
    const v = kind === "black" ? 0 : (i * 37) % 255;
    b[i] = v;
    b[i + 1] = v;
    b[i + 2] = v;
    b[i + 3] = 255;
  }
  return b as unknown as TilePatchBytes;
}

type Harness = {
  mon: TileHealthMonitor;
  heals: string[];
  blanks: string[];
  setPack: (id: string) => void;
  draw: () => void;
};

function harness(opts: {
  kind: Kind;
  live?: boolean;
  tiles?: string[];
  previewOnly?: (id: string) => boolean;
  skyStarting?: (id: string) => boolean;
  pack?: (id: string) => string;
}): Harness {
  let packId = "voxel-world";
  const scene = mockPartial<NetScene>({
    viewEl: document.createElement("div"),
    pictureSerial: 1, // never advances: without the floor, a non-uniform patch reads "stalled"
    gpuContextLost: false,
    lastViewport: viewMutAsDeviceRect({ x: 0, y: 0, w: 200, h: 120 }),
  });
  const tiles = opts.tiles ?? ["main"];
  const mosaic = tiles.length > 1 ? ({ on: true, tileIds: tiles } as unknown as TileHealthDeps["mosaic"]) : null;
  const heals: string[] = [];
  const blanks: string[] = [];
  const deps: TileHealthDeps = {
    host: { software: true, canvas: document.createElement("canvas"), pixelRatio: 1, gl: null } as unknown as RenderHost,
    mainScene: scene,
    mosaic,
    paneEl: () => scene.viewEl,
    sceneFor: () => scene,
    packFor: (id) => ({ id: opts.pack ? opts.pack(id) : packId } as PluginView),
    mayBeStatic: () => false,
    awaitingApproval: () => false,
    isVisible: () => true,
    showErrors: () => false,
    tabVisible: () => true,
    onScreen: () => true,
    onHeal: (id, step) => { heals.push(`${id}:${step}`); },
    onLiveBlank: (id, p, on) => { blanks.push(`${id}:${p}:${on}`); },
    previewOnly: opts.previewOnly,
    skyStarting: opts.skyStarting,
  };
  if (opts.live) deps.packLive = (_id, p) => p === packId;
  const mon = new TileHealthMonitor(deps);
  (mon as unknown as { sampleScene: () => TilePatchBytes }).sampleScene = () => patch(opts.kind);
  return {
    mon,
    heals,
    blanks,
    setPack: (id) => { packId = id; },
    draw: () => mon.noteSandboxWrite(),
  };
}

/** Advance `ms` of wall time, with the pack drawing before every check when `drawing`. */
function run(h: Harness, fromMs: number, ms: number, drawing: boolean): number {
  let t = fromMs;
  for (; t < fromMs + ms; t += CHECK_STEP_MS) {
    if (drawing) h.draw();
    h.mon.tick(t);
  }
  return t;
}

describe("tile-heal floor: ready frame with draws rising", () => {
  it("never escalates a ready, drawing pack with visible output (red without the floor)", () => {
    const h = harness({ kind: "noisy", live: true });
    run(h, 0, 60_000, true);
    expect(h.heals).toEqual([]);
    expect(h.blanks).toEqual([]);
  });

  it("control: the same tile without the floor climbs the ladder", () => {
    const h = harness({ kind: "noisy", live: false });
    run(h, 0, 60_000, true);
    expect(h.heals.length).toBeGreaterThan(0);
  });

  it("flags a ready, drawing pack whose output is truly uniform black with an on-screen notice", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const h = harness({ kind: "black", live: true });
    run(h, 0, 30_000, true);
    expect(h.heals).toEqual([]);
    expect(h.blanks).toEqual(["main:voxel-world:true"]);
    expect(info.mock.calls.some(([l]) => String(l).includes("reason=live-blank"))).toBe(true);
    info.mockRestore();
  });

  it("clears the notice when the pack stops drawing and the normal ladder takes over", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const h = harness({ kind: "black", live: true });
    const t = run(h, 0, 30_000, true);
    run(h, t, 60_000, false);
    expect(h.blanks).toEqual(["main:voxel-world:true", "main:voxel-world:false"]);
    expect(h.heals[0]).toBe(`main:${HEAL_LADDER[0]}`);
    info.mockRestore();
  });
});

describe("tile-heal floor: five-patch sampler and spaced reads", () => {
  it("Koi (flat centre, detailed edges) never gets the live-blank notice (red on a single centre patch)", () => {
    const koi = patch("koi");
    const centre = koi.subarray(0, TILE_PATCH * TILE_PATCH * 4);
    expect(patchIsNearUniform(centre)).toBe(true); // what the old centre-only sampler saw
    expect(patchesAreNearUniform(koi)).toBe(false);
    const h = harness({ kind: "koi", live: true });
    run(h, 0, 60_000, true);
    expect(h.blanks).toEqual([]);
    expect(h.heals).toEqual([]);
  });

  it("five flat patches that differ from each other are not uniform", () => {
    expect(patchesAreNearUniform(patch("tones5"))).toBe(false);
    const h = harness({ kind: "tones5", live: true });
    run(h, 0, 60_000, true);
    expect(h.blanks).toEqual([]);
  });

  it("truly black on all five patches is flagged, but only after 3 uniform reads at least 10s apart", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const h = harness({ kind: "black5", live: true });
    run(h, 0, 25_000, true); // grace + first two spaced reads at most
    expect(h.blanks).toEqual([]);
    run(h, 25_000, 20_000, true);
    expect(h.blanks).toEqual(["main:voxel-world:true"]);
    expect(h.heals).toEqual([]);
    info.mockRestore();
  });

  it("a non-uniform read between uniform ones restarts the count", () => {
    let kind: Kind = "black5";
    const h = harness({ kind: "black5", live: true });
    (h.mon as unknown as { sampleScene: () => TilePatchBytes }).sampleScene = () => patch(kind);
    let t = run(h, 0, 20_000, true);
    kind = "koi";
    t = run(h, t, 1_400, true);
    kind = "black5";
    run(h, t, 18_000, true);
    expect(h.blanks).toEqual([]);
  });
});

describe("tile-heal: pack change resets heal state", () => {
  it("Voxel at restart-pack, then Koi: Koi starts fresh and its first step is resend-frame", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const h = harness({ kind: "black" });
    let t = 0;
    while (!h.heals.includes("main:restart-pack") && t < 120_000) t = run(h, t, CHECK_STEP_MS, false);
    expect(h.heals).toContain("main:restart-pack");
    expect(h.mon.state("main").ladderIndex).toBeGreaterThan(0);
    h.setPack("koi-pond");
    h.heals.length = 0;
    const next = t + TILE_CHECK_MS;
    h.mon.tick(next);
    const s = h.mon.state("main");
    expect(s.ladderIndex).toBe(0);
    expect(s.healTimes).toEqual([]);
    expect(s.healAttempts).toBe(0);
    expect(s.backoffUntil).toBe(0);
    expect(s.pinnedFallback).toBe(freshTileHealthState().pinnedFallback);
    run(h, next + CHECK_STEP_MS, 120_000, false);
    expect(h.heals[0]).toBe("main:resend-frame");
    info.mockRestore();
  });
});

describe("tile-heal: mosaic preview panes (option 2)", () => {
  it("2x2 with two sandboxed packs: the pane without a sandbox is never healed to Topology in 40s", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const tiles = ["plugin:voxel-world", "plugin:koi-pond", "topology", "radial"];
    const h = harness({
      kind: "black",
      tiles,
      pack: (id) => id.replace("plugin:", ""),
      previewOnly: (id) => id === "plugin:koi-pond",
    });
    run(h, 0, 40_000, false);
    expect(h.heals.filter((x) => x.startsWith("plugin:koi-pond:"))).toEqual([]);
    expect(h.heals.some((x) => x.startsWith("topology:"))).toBe(true);
    info.mockRestore();
  });
});

describe("tile-heal: a view whose own sky is still starting", () => {
  it("is never healed and gets no blank notice while its Starting card is up (60s compile)", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    let starting = true;
    const h = harness({ kind: "black", live: true, skyStarting: () => starting });
    const t = run(h, 0, 60_000, true);
    expect(h.heals).toEqual([]);
    expect(h.blanks).toEqual([]);
    // Once the sky lands the tile is judged again: a still-uniform tile gets the notice.
    starting = false;
    run(h, t, 40_000, true);
    expect(h.blanks.some((b) => b.endsWith(":true"))).toBe(true);
    info.mockRestore();
  });
});
