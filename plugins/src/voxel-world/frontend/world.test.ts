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
import { hostWorldXZ } from "./hosts";
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
    const out = tickVoxelWorld({ t: 12, packets: [], demo: true, sys: { cpu: 0.2, failed: 0 } });
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
    for (let i = 0; i < 120; i++) {
      tickVoxelWorld({ t: i / 60, packets: [], demo: true, sys: { cpu: 0.2, failed: 0 } }, 1.6, 1 / 60);
    }
    resetGpuWarmupTracker();
    for (let i = 120; i < 240; i++) {
      tickVoxelWorld({ t: i / 60, packets: [], demo: true, sys: { cpu: 0.2, failed: 0 } }, 1.6, 1 / 60);
    }
    expect(gpuUploadGrowthAfterWarmup()).toBe(0);
    disposeVoxelWorld();
  });

  it("frees GPU resources after 20 mount cycles", () => {
    for (let i = 0; i < 20; i++) {
      initVoxelWorld();
      tickVoxelWorld({ t: i * 0.5, packets: [{ host: "10.0.0.9", field: 0.9 }], sys: { cpu: 0.1, failed: 0 } });
      disposeVoxelWorld();
    }
    const g = glCounts();
    expect(g.contexts).toBe(0);
    expect(g.programs).toBe(0);
    expect(g.textures).toBe(0);
    expect(g.buffers).toBe(0);
    expect(g.workers).toBe(0);
  });

  it("keeps host anchors stable when talkers reorder (same count)", () => {
    resetLiveMarkers();
    const opts = parseVoxConfig({ preset: "classic" });
    const cam = { x: 2, y: 11, z: -3 };
    const talkersA = [
      { id: "10.0.0.1", rate: 120, role: "lan" },
      { id: "10.0.0.2", rate: 80, role: "wan" },
    ];
    const talkersB = [talkersA[1]!, talkersA[0]!];
    const a = applyLiveBindings(
      { t: 4, packets: [], talkers: talkersA, sys: { cpu: 0.2, failed: 0 } },
      opts,
      0,
      cam,
    );
    resetLiveMarkers();
    const b = applyLiveBindings(
      { t: 4, packets: [], talkers: talkersB, sys: { cpu: 0.2, failed: 0 } },
      opts,
      0,
      cam,
    );
    expect(a.cloudCover).toBe(b.cloudCover);
    expect(a.hostAnchors.get("10.0.0.1")).toEqual(hostWorldXZ("10.0.0.1", opts.seed));
    expect(a.hostAnchors.get("10.0.0.1")).toEqual(b.hostAnchors.get("10.0.0.1"));
    expect(a.hostAnchors.get("10.0.0.2")).toEqual(b.hostAnchors.get("10.0.0.2"));
  });

  it("does not show failure visuals for healthy low-value packets", () => {
    resetLiveMarkers();
    const opts = parseVoxConfig({ preset: "classic" });
    const cam = { x: 0, y: 10, z: 0 };
    const out = applyLiveBindings(
      {
        t: 1,
        packets: [
          { host: "10.0.0.5", field: 0.02 },
          { host: "10.0.0.6", field: 0.08 },
        ],
        sys: { cpu: 0.1, failed: 0 },
      },
      opts,
      0,
      cam,
    );
    expect(out.failStrength).toBe(0);
    expect(out.beacons.every((b) => b.kind !== 9)).toBe(true);
  });

  it("consumes each new packet host up to the per-frame cap (not only index 0)", () => {
    resetLiveMarkers();
    const opts = parseVoxConfig({ preset: "classic" });
    const cam = { x: 0, y: 10, z: 0 };
    const out = applyLiveBindings(
      {
        t: 2,
        packets: [
          { host: "host-a", field: 0.92 },
          { host: "host-b", field: 0.93 },
          { host: "host-c", field: 0.94 },
        ],
        sys: { cpu: 0.1, failed: 0 },
      },
      opts,
      0,
      cam,
    );
    const torchHosts = out.beacons.filter((b) => b.kind === 1).map((b) => b.hostId);
    expect(torchHosts.sort()).toEqual(["host-a", "host-b", "host-c"]);
    expect(out.beacons[0]!.x).toBe(hostWorldXZ("host-a", opts.seed).x);
    expect(out.beacons[1]!.x).toBe(hostWorldXZ("host-b", opts.seed).x);
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
