import { describe, expect, it, beforeEach } from "vitest";
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
  packFractalDrive,
  resetFractalDrive,
} from "../../../plugins/src/fractal-zoom/frontend/drive";
import {
  FRACTAL_DEFAULTS,
  FRACTAL_PRESETS,
  parseFractalOptions,
  randomiseFractalOptions,
} from "../../../plugins/src/fractal-zoom/frontend/options";
import {
  FRACTAL_CONFIG_KEYS,
  fractalPresetConfig,
  validatePresetConfigsAgainstSchema,
  validatePresetKeysAgainstSchema,
} from "../../../plugins/src/fractal-zoom/frontend/config-mutation";
import {
  attachFractalInteraction,
  disposeFractalInteraction,
  fractalPointerState,
  IDLE_POINTER,
  resetFractalPointer,
} from "../../../plugins/src/fractal-zoom/frontend/interaction";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { PluginSandbox } from "./host";
import { runPackFrameHandler } from "./viz-pack-host";
import { DEMO_PACK_CONTRACTS } from "./dogfood-runner";
import { VizBufferWriter } from "./viz-host";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";
import { smokeFractalDefaultPresetSky } from "./fractal-sky-smoke";

describe("fractal-zoom shipped pack", () => {
  beforeEach(() => {
    resetFractalDrive();
    resetFractalPointer();
  });

  it("wraps and compiles the fractal sky (no WebGL errors)", () => {
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
    expect(PLUGIN).toMatch(/max:\s*32/);
    expect(PLUGIN).toMatch(/max:\s*48/);
    expect(VIS).not.toContain("key: fractalType");
    expect(VIS).toContain("stageOnly: true");
    expect(VIS).toContain("fixture: host");
  });

  it("iframe driver owns viz.write via config.read", () => {
    expect(FRONT).toContain("getConfig");
    expect(FRONT).toContain("writeBuffer");
    expect(FRONT).toContain("onFrame");
    expect(FRONT.match(/zoto\.onFrame\s*=/g)?.length).toBe(1);
  });

  it("parses defaults, presets, and reduced motion", () => {
    const def = parseFractalOptions({});
    expect(def.type).toBe(FRACTAL_DEFAULTS.type);
    expect(def.maxIter).toBe(32);
    expect(def.maxSteps).toBe(32);
    const reduced = parseFractalOptions({}, { reducedMotion: true });
    expect(reduced.paused || reduced.zoomSpeed <= 0.35).toBe(true);
    const preset = parseFractalOptions({ preset: "menger-tunnel" });
    expect(preset.type).toBe("menger");
    const rand = randomiseFractalOptions(0.42);
    expect(rand.preset).toBe("custom");
    expect(FRACTAL_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(validatePresetKeysAgainstSchema(FRACTAL_CONFIG_KEYS)).toEqual([]);
    expect(validatePresetConfigsAgainstSchema()).toEqual([]);
    for (const row of FRACTAL_PRESETS) {
      const cfg = fractalPresetConfig(row.id);
      expect(cfg.preset).toBe(row.id);
    }
  });

  it("locks render scale at 1.0 until host governor ships", () => {
    expect(fractalRenderScale()).toBe(1);
  });

  it("enforces hard iteration and step ceilings regardless of slider values", () => {
    expect(FRAG).toContain(`for (int i = 0; i < ${FRACTAL_STEPS_CEIL}; i++)`);
    expect(FRAG).toContain(`for (int i = 0; i < ${FRACTAL_ITER_CEIL}; i++)`);
    const huge = packFractalDrive(0, 1 / 60, 0, 1.6, { maxIter: "999", maxSteps: "999" }, IDLE_POINTER);
    expect(huge.slot0[FZ_SLOT.maxIterN]).toBe(1);
    expect(huge.slot0[FZ_SLOT.maxStepsN]).toBe(1);
  });

  it("fits the plugin buffer contract and advances zoom", () => {
    const a = packFractalDrive(0, 1 / 60, 0.1, 1.6, {}, IDLE_POINTER);
    const b = packFractalDrive(1, 1 / 60, 0.1, 1.6, { zoomSpeed: "1" }, IDLE_POINTER);
    expect(a.slot0).toHaveLength(FZ_SLOT0_FLOATS);
    expect(a.slot0.length).toBeLessThanOrEqual(64);
    expect(a.slot0[FZ_SLOT.mark]).toBe(1);
    expect(b.slot0[FZ_SLOT.zoomLog]).toBeGreaterThan(a.slot0[FZ_SLOT.zoomLog]!);
  });

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

  it("smoke: default preset draws a non-black centre pixel when WebGL2 is available", () => {
    const smoke = smokeFractalDefaultPresetSky();
    if (smoke.skipped) return;
    expect(smoke.compileError, "shader compile/link").toBeNull();
    expect(smoke.ok, `rgba=${smoke.rgba?.join(",")}`).toBe(true);
  });

  it("releases sandbox iframe and interaction after repeated mount/unmount", async () => {
    const el = document.createElement("div");
    const box = new PluginSandbox();
    const module = "globalThis.zoto.onFrame = () => {};";
    for (let i = 0; i < 5; i++) {
      attachFractalInteraction(el);
      disposeFractalInteraction();
      resetFractalDrive();
      await box.load("fractal-zoom", module, ["viz.read", "viz.write", "config.read"], { preset: "bulb-classic" });
      expect(document.querySelectorAll("iframe").length).toBe(1);
      box.unload();
      expect(document.querySelectorAll("iframe").length).toBe(0);
    }
    expect(fractalPointerState().dragging).toBe(false);
    expect(FRONT.match(/zoto\.onFrame\s*=/g)?.length).toBe(1);
  });

  it("detaches pointer listeners on dispose", () => {
    const el = document.createElement("div");
    attachFractalInteraction(el);
    disposeFractalInteraction();
    expect(fractalPointerState().dragging).toBe(false);
  });
});
