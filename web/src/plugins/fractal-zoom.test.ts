import { describe, expect, it, beforeEach, afterEach } from "vitest";
import FRAG from "../../../plugins/src/fractal-zoom/sky/fragment.glsl?raw";
import FRONT from "../../../plugins/src/fractal-zoom/frontend/index.ts?raw";
import VIS from "../../../plugins/src/fractal-zoom/visualisation.yml?raw";
import {
  FZ_SLOT,
  FZ_SLOT0_FLOATS,
  fractalDrive,
  getFractalAdaptiveScale,
  getFractalFrameMs,
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
  attachFractalInteraction,
  detachFractalInteraction,
  disposeFractalInteraction,
  fractalPointerState,
  resetFractalPointer,
} from "../../../plugins/src/fractal-zoom/frontend/interaction";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { runPackFrameHandler } from "./viz-pack-host";
import { DEMO_PACK_CONTRACTS } from "./dogfood-runner";
import { VizBufferWriter } from "./viz-host";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";

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

  it("declares host golden idle and rich config in visualisation.yml", () => {
    expect(VIS).toContain("fixture: host");
    expect(VIS).toContain("stageOnly: true");
    expect(VIS).toContain("key: fractalType");
    expect(VIS).toContain("key: preset");
    expect(VIS).toContain("key: renderScale");
  });

  it("leaves camera buffers to the host", () => {
    expect(FRONT).not.toMatch(/writeBuffer\s*\(/);
  });

  it("parses defaults, presets, and reduced motion", () => {
    const def = parseFractalOptions({});
    expect(def.type).toBe(FRACTAL_DEFAULTS.type);
    expect(def.maxIter).toBe(72);
    const reduced = parseFractalOptions({}, { reducedMotion: true });
    expect(reduced.paused || reduced.zoomSpeed <= 0.35).toBe(true);
    const preset = parseFractalOptions({ preset: "menger-tunnel" });
    expect(preset.type).toBe("menger");
    const rand = randomiseFractalOptions(0.42);
    expect(rand.preset).toBe("custom");
    expect(FRACTAL_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("fits the plugin buffer contract and advances zoom", () => {
    const a = packFractalDrive(0, 1 / 60, 0.1, 1.6, {}, fractalPointerState());
    const b = packFractalDrive(1, 1 / 60, 0.1, 1.6, { zoomSpeed: "1" }, fractalPointerState());
    expect(a.slot0).toHaveLength(FZ_SLOT0_FLOATS);
    expect(a.slot0.length).toBeLessThanOrEqual(64);
    expect(a.slot0[FZ_SLOT.mark]).toBe(1);
    expect(b.slot0[FZ_SLOT.zoomLog]).toBeGreaterThan(a.slot0[FZ_SLOT.zoomLog]!);
  });

  it("adapts render scale when frame time spikes", () => {
    fractalDrive({
      t: 0,
      dt: 1 / 30,
      audio: 0,
      aspect: 1,
      opts: parseFractalOptions({ renderScale: "1" }),
      pointer: fractalPointerState(),
    });
    const base = getFractalAdaptiveScale();
    fractalDrive({
      t: 0.1,
      dt: 1 / 15,
      audio: 0,
      aspect: 1,
      opts: parseFractalOptions({ renderScale: "1" }),
      pointer: fractalPointerState(),
    });
    expect(getFractalFrameMs()).toBeGreaterThan(20);
    expect(getFractalAdaptiveScale()).toBeLessThanOrEqual(base);
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

  it("detaches pointer listeners on dispose", () => {
    const el = document.createElement("div");
    attachFractalInteraction(el);
    disposeFractalInteraction();
    detachFractalInteraction();
    expect(fractalPointerState().dragging).toBe(false);
  });
});
