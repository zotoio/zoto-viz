import { describe, expect, it } from "vitest";
import { VOX_CONFIG_KEYS } from "./config-manifest";
import { parseVoxConfig, voxOptionsToConfig, voxRenderScale } from "./config";
import { applyLiveBindings, beaconScratch, resetLiveMarkers } from "./bindings";
import { screenMarkerMembershipFingerprint } from "./marker-select";
import { goldenLiveFrame } from "./fixtures/golden-live";
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
import { anchorXZ, flowCacheHandles, talkerLayoutRebuilds } from "./talker-cache";
import { persistentSlotBuffers } from "./slots";
import { terrainHeight, villageAnchor } from "./world";
import { VOX_SLOT } from "./slots";
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

  it("applies preset bundle when preset key is present (ignores stale fields)", () => {
    const o = parseVoxConfig({ preset: "snowy", seed: "1", biome: "arid", fog: "0.1" });
    expect(o.seed).toBe(9001);
    expect(o.biome).toBe("boreal");
    expect(o.fog).toBeGreaterThan(0.5);
  });

  it("randomise undo reset return full config and clear stale undo on reset", () => {
    resetVoxConfig();
    const s0 = randomiseVoxConfig(() => 0.5).opts.seed;
    const undone = undoVoxConfig();
    expect(undone?.opts.seed).toBe(4242);
    expect(undone?.cfg.preset).toBe("classic");
    const s1 = randomiseVoxConfig(() => 0.1).opts.seed;
    expect(s1).not.toBe(s0);
    const back = resetVoxConfig();
    expect(back.cfg.preset).toBe("classic");
    expect(back.cfg.seed).toBe("4242");
    expect(undoVoxConfig()).toBeNull();
    expect(voxOptionsToConfig(back.opts).biome).toBe("temperate");
  });

  it("archipelago islands village sits on terrain height", () => {
    setVoxConfig({ preset: "archipelago" });
    const o = parseVoxConfig({ preset: "archipelago" });
    const v = villageAnchor(o.seed, o.biome);
    const ground = terrainHeight(v.x, v.z, o.seed, o.biome);
    expect(ground).toBeGreaterThan(8);
    const out = tickVoxelWorld(
      liveSlice({
        t: 5,
        packets: [],
        talkers: [],
        headlines: [],
        demo: true,
        sys: { cpu: 0.2, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 },
      }),
    );
    expect(out.slot0[VOX_SLOT.villageX]).toBeCloseTo(v.x, 3);
    expect(out.slot0[VOX_SLOT.villageZ]).toBeCloseTo(v.z, 3);
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
    const rebuildsAfterFirst = talkerLayoutRebuilds();
    const b = applyLiveBindings(liveSlice({ t: 4.1, ...frameBase, talkers: talkersB }), opts, cam);
    expect(a.cloudCover).toBe(b.cloudCover);
    const m1 = flowCacheHandles().talkerMarkers.get("10.0.0.1")!;
    expect(m1.x).toBeCloseTo(anchorXZ("10.0.0.1", opts.seed).x, 4);
    expect(flowCacheHandles().talkerMarkers.get("10.0.0.1")!.x).toBe(m1.x);
    expect(talkerLayoutRebuilds()).toBe(rebuildsAfterFirst);
  });

  it("updates talker marker kind/strength every frame on cached id set", () => {
    resetLiveMarkers();
    const opts = parseVoxConfig({ preset: "classic" });
    const cam = { x: 0, y: 10, z: 0 };
    const sys = { cpu: 0.1, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 };
    const id = "10.0.0.50";
    applyLiveBindings(
      liveSlice({ t: 1, packets: [], talkers: [{ id, rate: 200, role: "lan" }], headlines: [], sys }),
      opts,
      cam,
    );
    let m = flowCacheHandles().talkerMarkers.get(id)!;
    expect(m.kind).toBe(2);
    expect(m.strength).toBeGreaterThan(0.5);
    applyLiveBindings(
      liveSlice({ t: 2, packets: [], talkers: [{ id, rate: 0, role: "lan" }], headlines: [], sys }),
      opts,
      cam,
    );
    m = flowCacheHandles().talkerMarkers.get(id)!;
    expect(m.kind).toBe(0);
    expect(m.strength).toBe(0);
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
    expect(beaconScratch().every((b) => b.kind !== 9)).toBe(true);
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
    expect(beaconScratch().every((b) => b.kind !== 9)).toBe(true);
  });

  it("lets strong protocol markers win top slots over weak talker IPs", () => {
    resetLiveMarkers();
    setVoxConfig({ preset: "classic", mobs: "0" });
    const sys = { cpu: 0.1, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 };
    const talkers: VizTalkerSample[] = [
      { id: "10.0.0.1", rate: 5, role: "lan" },
      { id: "10.0.0.2", rate: 5, role: "lan" },
      { id: "10.0.0.3", rate: 5, role: "lan" },
      { id: "10.0.0.4", rate: 5, role: "lan" },
      { id: "10.0.0.5", rate: 5, role: "lan" },
      { id: "10.0.0.6", rate: 5, role: "lan" },
    ];
    const out = tickVoxelWorld(
      liveSlice({
        t: 3,
        packets: [{ proto: "quic", size: 9000, field: 0.98 }],
        talkers,
        headlines: [],
        sys,
      }),
    );
    const keys = beaconScratch().filter((b) => b.kind === 1).map((b) => b.key);
    expect(keys).toContain("quic");
    expect(out.slot1[0]).toBeCloseTo(anchorXZ("quic", parseVoxConfig({ preset: "classic" }).seed).x, 3);
  });

  it("fills empty beacon slots immediately and fades new talkers in", () => {
    resetLiveMarkers();
    setVoxConfig({ preset: "classic", mobs: "0" });
    const sys = { cpu: 0.1, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 };
    const dt = 1 / 60;
    tickVoxelWorld(liveSlice({ t: 0, packets: [], talkers: [], headlines: [], sys }), 1.6, dt);
    expect(screenMarkerMembershipFingerprint()).toBe("");
    tickVoxelWorld(
      liveSlice({
        t: dt,
        packets: [],
        talkers: [{ id: "10.0.0.9", rate: 80, role: "lan" }],
        headlines: [],
        sys,
      }),
      1.6,
      dt,
    );
    expect(screenMarkerMembershipFingerprint()).toBe("10.0.0.9");
    const s0 = beaconScratch().find((b) => b.key === "10.0.0.9")!.strength;
    expect(s0).toBeGreaterThan(0);
    expect(s0).toBeLessThan(0.95);
    tickVoxelWorld(
      liveSlice({
        t: dt * 2,
        packets: [],
        talkers: [{ id: "10.0.0.9", rate: 80, role: "lan" }],
        headlines: [],
        sys,
      }),
      1.6,
      dt,
    );
    expect(beaconScratch().find((b) => b.key === "10.0.0.9")!.strength).toBeGreaterThan(s0);
  });

  it("hysteresis limits beacon membership churn when two talkers alternate narrowly", () => {
    resetLiveMarkers();
    setVoxConfig({ preset: "classic", mobs: "0" });
    const sys = { cpu: 0.1, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 };
    let lastFp = "";
    let lastChangeT = -1;
    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) {
      const t = i * dt;
      const useA = i % 2 === 0;
      tickVoxelWorld(
        liveSlice({
          t,
          packets: [],
          talkers: useA
            ? [{ id: "10.0.0.1", rate: 100, role: "lan" }]
            : [{ id: "10.0.0.2", rate: 100, role: "lan" }],
          headlines: [],
          sys,
        }),
        1.6,
        dt,
      );
      const fp = screenMarkerMembershipFingerprint();
      if (!fp) continue;
      if (fp !== lastFp) {
        if (lastChangeT >= 0) expect(t - lastChangeT).toBeGreaterThanOrEqual(1 - 1e-6);
        lastChangeT = t;
        lastFp = fp;
      }
    }
  });

  it("reuses flow maps and slot buffers over 300 golden-live frames", () => {
    resetVoxConfig();
    initVoxelWorld();
    const before = flowCacheHandles();
    const slotsBefore = persistentSlotBuffers();
    for (let i = 0; i < 300; i++) {
      const frame = goldenLiveFrame(i / 60);
      tickVoxelWorld(liveSlice(frame), 1.6, 1 / 60);
    }
    const after = flowCacheHandles();
    const slotsAfter = persistentSlotBuffers();
    expect(after.talkerMarkers).toBe(before.talkerMarkers);
    expect(after.rateById).toBe(before.rateById);
    expect(after.protoMarkers).toBe(before.protoMarkers);
    expect(slotsAfter.slot0).toBe(slotsBefore.slot0);
    expect(slotsAfter.slot1).toBe(slotsBefore.slot1);
    disposeVoxelWorld();
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
