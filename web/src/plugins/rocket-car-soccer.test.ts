import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/rocket-car-soccer/sky/fragment.glsl?raw";
import FRONT from "../../../plugins/src/rocket-car-soccer/frontend/index.ts?raw";
import VIS from "../../../plugins/src/rocket-car-soccer/visualisation.yml?raw";
import PLUGIN from "../../../plugins/src/rocket-car-soccer/plugin.yml?raw";
import {
  RCS_DEFAULTS,
  RCS_MAX_CARS,
  RCS_MAX_SUBSTEPS,
  RCS_MAX_TEAM,
  RCS_PRESETS,
  RCS_SLOT,
  parseRcsOptions,
  presetConfigValues,
  rcsRenderScale,
  rcsTeardown,
  rcsTrackGpu,
  validatePreset,
} from "../../../plugins/src/rocket-car-soccer/frontend/pack";
import {
  enforceRcsCaps,
  maxSubstepsFor,
  rcsFrame,
  rcsOptionsNow,
  rcsPackFrame,
  rcsSampleAt,
  resetRcsSim,
  setRcsOptions,
} from "../../../plugins/src/rocket-car-soccer/frontend/match";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";

describe("rocket-car-soccer pack", () => {
  it("wraps and compiles the arena sky", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("zotoVizSlots");
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("declares config.read and bounded viz contract in plugin.yml", () => {
    expect(PLUGIN).toMatch(/config\.read/);
    expect(PLUGIN).toMatch(/maxBuffers:\s*3/);
    expect(PLUGIN).toMatch(/maxBufferFloats:\s*64/);
  });

  it("validates every preset against option clamps", () => {
    for (const id of Object.keys(RCS_PRESETS)) {
      expect(validatePreset(id)).toBe(true);
      const merged = enforceRcsCaps(parseRcsOptions(presetConfigValues(id as keyof typeof RCS_PRESETS)));
      expect(merged.teamSize).toBeLessThanOrEqual(RCS_MAX_TEAM);
      expect(merged.particles).toBeLessThanOrEqual(100);
    }
  });

  it("reads each shipped config key", () => {
    const keys = [...VIS.matchAll(/- key: (\w+)/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(10);
    const base = JSON.stringify(parseRcsOptions({}));
    for (const key of keys) {
      if (key === "dice" || key === "preset" || key === "teamOrange" || key === "teamBlue") continue;
      const chunk = VIS.split(`key: ${key}`)[1]!.split("- key:")[0]!;
      const def = chunk.match(/default: (\S+)/)?.[1] ?? "";
      const min = Number(chunk.match(/min: (\S+)/)?.[1]);
      const max = Number(chunk.match(/max: (\S+)/)?.[1]);
      let flip = /true|false/.test(def) ? (def === "true" ? "false" : "true") : "17";
      if (Number.isFinite(min) && Number.isFinite(max)) {
        const d = Number(def);
        flip = String(Number.isFinite(d) && d > min ? min : max);
      }
      const selectVal = chunk.match(/-\s+\[(\w+),/);
      if (selectVal && selectVal[1] !== def) flip = selectVal[1]!;
      else if (selectVal) {
        const alt = [...chunk.matchAll(/-\s+\[(\w+),/g)].map((m) => m[1]!).find((v) => v !== def);
        if (alt) flip = alt;
      }
      expect(JSON.stringify(parseRcsOptions({ [key]: flip })), key).not.toBe(base);
    }
  });

  it("enforces car, substep, and team caps", () => {
    setRcsOptions({ teamSize: "9", gameSpeed: "500", particles: "500" });
    const o = rcsOptionsNow();
    expect(o.teamSize).toBe(RCS_MAX_TEAM);
    expect(o.particles).toBeLessThanOrEqual(100);
    expect(maxSubstepsFor(1 / 30)).toBeLessThanOrEqual(RCS_MAX_SUBSTEPS);
    resetRcsSim(1);
    const packed = rcsPackFrame(1.6);
    expect(packed.slot0[RCS_SLOT.carCount]).toBeLessThanOrEqual(RCS_MAX_CARS);
    setRcsOptions({});
  });

  it("is deterministic for a fixed seed and time", () => {
    const a = rcsSampleAt(12.5, 0xdecaf);
    const b = rcsSampleAt(12.5, 0xdecaf);
    expect(a).toEqual(b);
  });

  it("releases tracked GPU buffers on teardown", () => {
    rcsTrackGpu(3, 12);
    expect(rcsTeardown()).toEqual({ buffers: 3, particles: 12 });
    expect(rcsTeardown()).toEqual({ buffers: 0, particles: 0 });
  });

  it("smoke-packs non-zero drive data (never an empty board)", () => {
    resetRcsSim(99);
    setRcsOptions({});
    const f = rcsFrame(1 / 60, 1.777);
    expect(f.slot0[RCS_SLOT.mark]).toBe(1);
    const energy = [...f.slot0, ...f.slot1, ...f.slot2].reduce((s, v) => s + Math.abs(v), 0);
    expect(energy).toBeGreaterThan(10);
    const avg = energy / (f.slot0.length + f.slot1.length + f.slot2.length);
    expect(avg).toBeGreaterThan(0.05);
  });

  it("keeps render scale at 1.0 behind the swappable hook", () => {
    expect(rcsRenderScale()).toBe(1);
  });

  it("leaves buffer writes to the host sky clock", () => {
    expect(FRONT).not.toMatch(/writeBuffer\s*\(/);
  });

  it("parses team colour overrides", () => {
    const o = parseRcsOptions({ teamOrange: "#aabbcc", teamBlue: "#112233" });
    expect(o.teamOrange).toBe("#aabbcc");
    expect(o.teamBlue).toBe("#112233");
  });

  it("each preset exports stable config strings", () => {
    for (const id of Object.keys(RCS_PRESETS)) {
      expect(validatePreset(id)).toBe(true);
      const cfg = presetConfigValues(id as keyof typeof RCS_PRESETS);
      expect(cfg.preset).toBe(id);
      expect(parseRcsOptions(cfg).teamSize).toBeGreaterThanOrEqual(2);
    }
  });
});
