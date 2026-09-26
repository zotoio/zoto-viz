import { describe, expect, it, beforeEach, afterEach } from "vitest";
import FRAG from "../../../plugins/src/fractal-zoom/sky/fragment.glsl?raw";
import FRONT from "../../../plugins/src/fractal-zoom/frontend/index.ts?raw";
import VIS from "../../../plugins/src/fractal-zoom/visualisation.yml?raw";
import PLUGIN from "../../../plugins/src/fractal-zoom/plugin.yml?raw";
import {
  FZ_SLOT,
  FZ_SLOT0_FLOATS,
  FRACTAL_ITER_CEIL,
  FRACTAL_STEPS_CEIL,
  fractalRenderScale,
  getFractalFrameMs,
  packFractalDrive,
  resetFractalDrive,
} from "../../../plugins/src/fractal-zoom/frontend/drive";
import {
  FRACTAL_DEFAULTS,
  FRACTAL_PRESETS,
  FRACTAL_TYPES,
  parseFractalOptions,
  randomiseFractalOptions,
} from "../../../plugins/src/fractal-zoom/frontend/options";
import {
  FRACTAL_CONFIG_KEYS,
  validatePresetKeysAgainstSchema,
  worstCaseFractalConfig,
} from "../../../plugins/src/fractal-zoom/frontend/config-mutation";
import {
  attachFractalInteraction,
  detachFractalInteraction,
  disposeFractalInteraction,
  fractalPointerState,
  IDLE_POINTER,
  resetFractalPointer,
} from "../../../plugins/src/fractal-zoom/frontend/interaction";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { runPackFrameHandler } from "./viz-pack-host";
import { DEMO_PACK_CONTRACTS } from "./dogfood-runner";
import { VizBufferWriter } from "./viz-host";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";
import { benchFractalSkyWorstCaseAllTypes, fractalSkyBenchLastError } from "./fractal-sky-gpu-bench";

const FRAME_BUDGET_MS = 50;

function benchDriveMs(config: Record<string, string>, frames = 12): number {
  let max = 0;
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    packFractalDrive(i * 0.016, 0.016, 0.25, 16 / 10, config, IDLE_POINTER);
    max = Math.max(max, performance.now() - t0);
  }
  return max;
}

describe("fractal-zoom shipped pack", () => {
  beforeEach(() => {
    resetFractalDrive();
    resetFractalPointer();
  });

  it("wraps and compiles the fractal sky", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("zotoVizSlots");
    expect(FRAG).toContain("mandelbulb");
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("declares config schema in plugin.yml with config.read (not visualisation.yml)", () => {
    expect(PLUGIN).toContain("config.read");
    expect(PLUGIN).toContain("key: fractalType");
    expect(PLUGIN).toContain("key: preset");
    expect(PLUGIN).toContain("section: Presets");
    expect(VIS).not.toContain("key: fractalType");
    expect(VIS).toContain("stageOnly: true");
    expect(VIS).toContain("fixture: host");
  });

  it("iframe driver owns viz.write via config.read", () => {
    expect(FRONT).toContain("getConfig");
    expect(FRONT).toContain("writeBuffer");
    expect(FRONT).toContain("onFrame");
  });

  it("parses defaults, presets, and reduced motion", () => {
    const def = parseFractalOptions({});
    expect(def.type).toBe(FRACTAL_DEFAULTS.type);
    expect(def.maxIter).toBe(32);
    const reduced = parseFractalOptions({}, { reducedMotion: true });
    expect(reduced.paused || reduced.zoomSpeed <= 0.35).toBe(true);
    const preset = parseFractalOptions({ preset: "menger-tunnel" });
    expect(preset.type).toBe("menger");
    const rand = randomiseFractalOptions(0.42);
    expect(rand.preset).toBe("custom");
    expect(FRACTAL_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(validatePresetKeysAgainstSchema(FRACTAL_CONFIG_KEYS)).toEqual([]);
  });

  it("fits the plugin buffer contract and advances zoom", () => {
    const a = packFractalDrive(0, 1 / 60, 0.1, 1.6, {}, IDLE_POINTER);
    const b = packFractalDrive(1, 1 / 60, 0.1, 1.6, { zoomSpeed: "1" }, IDLE_POINTER);
    expect(a.slot0).toHaveLength(FZ_SLOT0_FLOATS);
    expect(a.slot0.length).toBeLessThanOrEqual(64);
    expect(a.slot0[FZ_SLOT.mark]).toBe(1);
    expect(b.slot0[FZ_SLOT.zoomLog]).toBeGreaterThan(a.slot0[FZ_SLOT.zoomLog]!);
  });

  // TODO(VizFrameBudget): relax FRACTAL_*_CEIL and assert worst-case GPU time at fractalRenderScale() minimum step, not only 1.0.
  it("locks render scale at 1.0 until host governor ships", () => {
    expect(fractalRenderScale()).toBe(1);
  });

  it("caps shader loops to drive.ts ceilings", () => {
    expect(FRAG).toContain(`for (int i = 0; i < ${FRACTAL_STEPS_CEIL}; i++)`);
    expect(FRAG).toContain(`for (int i = 0; i < ${FRACTAL_ITER_CEIL}; i++)`);
  });

  // Isolated sky in Chromium (not plugin srcdoc) — avoids sandbox CSP script-src 'self' blocking inline module scripts.
  it("worst-case GPU frame stays under 50 ms at render scale 1.0 per fractal type", async () => {
    const timings = await benchFractalSkyWorstCaseAllTypes(FRACTAL_TYPES);
    expect(timings, `GPU bench failed: ${fractalSkyBenchLastError()}`).not.toBeNull();
    for (const type of FRACTAL_TYPES) {
      const ms = timings!.get(type);
      expect(ms, `missing timing for ${type}`).toBeDefined();
      expect(ms!, `${type} @ render scale 1.0 (1280×800, isolated sky)`).toBeLessThan(FRAME_BUDGET_MS);
    }
  }, 120_000);

  it("runs host pack handler on idle demo frame", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["fractal-zoom"]);
    const frame = buildIdleVizFrame(0);
    const buf: number[] = [];
    runPackFrameHandler("fractal-zoom", frame, {
      writeBuffer: (slot, data) => { buf.push(...data); writer.writeBuffer(slot, data); },
      writeUniform: () => {},
      writeParticles: () => {},
    }, {});
    expect(buf.length).toBe(FZ_SLOT0_FLOATS);
    expect(buf[FZ_SLOT.mark]).toBe(1);
  });

  it("stays within ~10% frame budget after 20 view teardown cycles", () => {
    const baseline = benchDriveMs(worstCaseFractalConfig("mandelbulb"), 6);
    for (let i = 0; i < 20; i++) {
      resetFractalDrive();
      resetFractalPointer();
      packFractalDrive(i * 0.02, 0.02, 0.1, 1.6, { preset: "bulb-classic" }, IDLE_POINTER);
    }
    const after = benchDriveMs(worstCaseFractalConfig("mandelbulb"), 6);
    expect(after).toBeLessThanOrEqual(baseline * 1.1 + 0.05);
    expect(getFractalFrameMs()).toBeLessThan(100);
  });

  it("detaches pointer listeners on dispose", () => {
    const el = document.createElement("div");
    attachFractalInteraction(el);
    disposeFractalInteraction();
    detachFractalInteraction();
    expect(fractalPointerState().dragging).toBe(false);
  });
});
