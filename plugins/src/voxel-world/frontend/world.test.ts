import { describe, expect, it } from "vitest";
import { VOX_CONFIG_KEYS } from "./config-manifest";
import { parseVoxConfig, voxRenderScale } from "./config";
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
      tickVoxelWorld({ t: i * 0.5, packets: [{ field: 0.9 }], sys: { cpu: 0.1, failed: 0 } });
      disposeVoxelWorld();
    }
    const g = glCounts();
    expect(g.contexts).toBe(0);
    expect(g.programs).toBe(0);
    expect(g.textures).toBe(0);
    expect(g.buffers).toBe(0);
    expect(g.workers).toBe(0);
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
