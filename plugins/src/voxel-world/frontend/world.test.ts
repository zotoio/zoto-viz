import { describe, expect, it } from "vitest";
import { VOX_CONFIG_KEYS } from "./config-manifest";
import { parseVoxConfig, voxRenderScale } from "./config";
import { applyLiveBindings, resetLiveMarkers } from "./bindings";
import {
  disposeVoxelWorld,
  initVoxelWorld,
  randomiseVoxConfig,
  resetVoxConfig,
  setVoxConfig,
  simulateFlyover,
  tickVoxelWorld,
  undoVoxConfig,
  voxelSmokeCenterLuma,
} from "./engine";
import { anchorXZ, talkerLayoutStats } from "./talker-cache";
import type { VizDataFrame, VizPacketSample, VizTalkerSample } from "./viz-frame";
import {
  gpuCounts as glCounts,
  gpuUploadGrowthAfterWarmup,
  initGpuRenderer,
  disposeGpuRenderer,
  resetGpuWarmupTracker,
} from "./gl-renderer";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const BANNED = [/minecraft/i, /mojang/i, /rocket\s*league/i, /psyonix/i];

function walkPackFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkPackFiles(p));
    else if (/\.(yml|ts|glsl|md|mts)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

function liveSlice(
  partial: Pick<VizDataFrame, "t" | "packets" | "talkers" | "demo" | "sys" | "headlines">,
): Pick<VizDataFrame, "t" | "packets" | "talkers" | "demo" | "sys" | "headlines"> {
  return partial;
}

describe("voxel world pack", () => {
  it("has no banned trademark strings in pack sources", () => {
    const text = walkPackFiles(ROOT).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const re of BANNED) expect(text).not.toMatch(re);
  });

  it("config keys in plugin.yml match config-manifest", () => {
    const yml = readFileSync(join(ROOT, "plugin.yml"), "utf8");
    const keys = [...yml.matchAll(/^\s+-\s+key:\s+(\w+)/gm)].map((m) => m[1]!).sort();
    expect(keys).toEqual([...VOX_CONFIG_KEYS].sort());
  });

  it("shader references live and osd slots", () => {
    const frag = readFileSync(join(ROOT, "sky/fragment.glsl"), "utf8");
    expect(frag).toContain("zotoVizSlots");
    expect(frag).toContain("slot(23)");
    expect(frag).toContain("beaconCol");
  });

  it("keeps flyover chunk rebuilds within cap (pinned seed 4242, 30s)", () => {
    const presets = ["classic", "snowy", "desert", "night", "archipelago"] as const;
    for (const p of presets) {
      setVoxConfig(p === "classic" ? { preset: p, seed: "4242" } : { preset: p });
      const { maxRebuild } = simulateFlyover(30, 60);
      expect(maxRebuild).toBeLessThanOrEqual(2);
    }
  });

  it("keeps draw calls and triangles under caps for heaviest preset", () => {
    setVoxConfig({ preset: "desert", seed: "1337" });
    const o = parseVoxConfig({ preset: "desert", seed: "1337" });
    const { maxDraw, maxTri } = simulateFlyover(30, 60);
    expect(maxDraw).toBeLessThanOrEqual(o.caps.maxChunks);
    expect(maxTri).toBeLessThanOrEqual(o.caps.vertexBudget / 3);
  });

  it("smoke luma stays above near-black for pinned seed", () => {
    resetVoxConfig();
    const out = tickVoxelWorld(
      liveSlice({ t: 12, packets: [], talkers: [], headlines: [], demo: true, sys: { cpu: 0.2, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 } }),
    );
    expect(voxelSmokeCenterLuma(out.slot0)).toBeGreaterThan(0.12);
    expect(voxRenderScale()).toBe(1);
  });

  it("randomise undo reset only via config", () => {
    resetVoxConfig();
    const s0 = randomiseVoxConfig(() => 0.5).seed;
    expect(undoVoxConfig()?.seed).toBe(parseVoxConfig({ preset: "classic" }).seed);
    const s1 = randomiseVoxConfig(() => 0.1).seed;
    expect(s1).not.toBe(s0);
    resetVoxConfig();
    expect(parseVoxConfig({ preset: "classic" }).seed).toBe(4242);
  });

  it("does not grow GPU byte accounting after warm-up uploads", () => {
    resetVoxConfig();
    initVoxelWorld();
    const sys = { cpu: 0.2, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 };
    for (let i = 0; i < 120; i++) {
      tickVoxelWorld(liveSlice({ t: i / 60, packets: [], talkers: [], headlines: [], demo: true, sys }), 1.6, 1 / 60);
    }
    resetGpuWarmupTracker();
    for (let i = 120; i < 240; i++) {
      tickVoxelWorld(liveSlice({ t: i / 60, packets: [], talkers: [], headlines: [], demo: true, sys }), 1.6, 1 / 60);
    }
    expect(gpuUploadGrowthAfterWarmup()).toBe(0);
    disposeVoxelWorld();
  });

  it("frees GPU resources after 20 mount cycles", () => {
    const sys = { cpu: 0.1, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 };
    for (let i = 0; i < 20; i++) {
      initVoxelWorld();
      tickVoxelWorld(
        liveSlice({
          t: i * 0.5,
          packets: [{ proto: "tcp", size: 900, field: 0.9 }],
          talkers: [],
          headlines: [],
          sys,
        }),
      );
      disposeVoxelWorld();
    }
    const g = glCounts();
    expect(g.contexts).toBe(0);
    expect(g.programs).toBe(0);
    expect(g.textures).toBe(0);
    expect(g.buffers).toBe(0);
    expect(g.workers).toBe(0);
  });

  it("keeps talker anchors stable when talkers reorder (same ids)", () => {
    resetLiveMarkers();
    const opts = parseVoxConfig({ preset: "classic" });
    const cam = { x: 2, y: 11, z: -3 };
    const talkersA: VizTalkerSample[] = [
      { id: "10.0.0.1", rate: 120, role: "lan" },
      { id: "10.0.0.2", rate: 80, role: "gateway" },
    ];
    const talkersB: VizTalkerSample[] = [talkersA[1]!, talkersA[0]!];
    const frameBase = { packets: [] as VizPacketSample[], headlines: [], sys: { cpu: 0.2, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 } };
    const a = applyLiveBindings(liveSlice({ t: 4, ...frameBase, talkers: talkersA }), opts, cam);
    const rebuildsAfterFirst = talkerLayoutStats().rebuilds;
    const b = applyLiveBindings(liveSlice({ t: 4.1, ...frameBase, talkers: talkersB }), opts, cam);
    expect(a.cloudCover).toBe(b.cloudCover);
    expect(a.talkerAnchors.get("10.0.0.1")).toEqual(anchorXZ("10.0.0.1", opts.seed));
    expect(a.talkerAnchors.get("10.0.0.1")).toEqual(b.talkerAnchors.get("10.0.0.1"));
    expect(talkerLayoutStats().rebuilds).toBe(rebuildsAfterFirst);
  });

  it("does not treat low packet field as failure (sys.failed only)", () => {
    resetLiveMarkers();
    const opts = parseVoxConfig({ preset: "classic" });
    const cam = { x: 0, y: 10, z: 0 };
    const out = applyLiveBindings(
      liveSlice({
        t: 1,
        packets: [
          { proto: "icmp", size: 40, field: 0.02 },
          { proto: "dns", size: 80, field: 0.08 },
        ],
        talkers: [],
        headlines: [{ id: "h1", label: "alert", text: "disk full" }],
        sys: { cpu: 0.1, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 },
      }),
      opts,
      cam,
    );
    expect(out.failStrength).toBe(0);
    expect(out.beacons.every((b) => b.kind !== 9)).toBe(true);
  });

  it("applies world-wide fail from sys.failed without pinning a beacon", () => {
    resetLiveMarkers();
    const opts = parseVoxConfig({ preset: "classic" });
    const cam = { x: 0, y: 10, z: 0 };
    const out = applyLiveBindings(
      liveSlice({
        t: 1,
        packets: [],
        talkers: [],
        headlines: [],
        sys: { cpu: 0.1, failed: 0.9, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 },
      }),
      opts,
      cam,
    );
    expect(out.failStrength).toBeGreaterThan(0.2);
    expect(out.beacons.every((b) => b.kind !== 9)).toBe(true);
  });

  it("consumes each packet in the frame up to the cap (proto-keyed, not index 0 only)", () => {
    resetLiveMarkers();
    const opts = parseVoxConfig({ preset: "classic" });
    const cam = { x: 0, y: 10, z: 0 };
    const out = applyLiveBindings(
      liveSlice({
        t: 2,
        packets: [
          { proto: "tcp", size: 1200, field: 0.92 },
          { proto: "udp", size: 800, field: 0.93 },
          { proto: "quic", size: 600, field: 0.94 },
        ],
        talkers: [],
        headlines: [],
        sys: { cpu: 0.1, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 },
      }),
      opts,
      cam,
    );
    const torchKeys = out.beacons.filter((b) => b.kind === 1).map((b) => b.key).sort();
    expect(torchKeys).toEqual(["quic", "tcp", "udp"]);
    expect(out.beacons.find((b) => b.key === "tcp")!.x).toBe(anchorXZ("tcp", opts.seed).x);
  });

  it("never stacks more than one GL context per tile lifecycle (4 isolated tiles)", () => {
    const contexts: number[] = [];
    for (let i = 0; i < 4; i++) {
      initGpuRenderer();
      contexts.push(glCounts().contexts);
      disposeGpuRenderer();
      expect(glCounts().contexts).toBe(0);
    }
    expect(Math.max(...contexts)).toBeLessThanOrEqual(1);
  });
});
