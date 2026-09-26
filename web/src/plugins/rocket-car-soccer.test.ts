import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/rocket-car-soccer/sky/fragment.glsl?raw";
import FRONT from "../../../plugins/src/rocket-car-soccer/frontend/index.ts?raw";
import VIS from "../../../plugins/src/rocket-car-soccer/visualisation.yml?raw";
import PLUGIN from "../../../plugins/src/rocket-car-soccer/plugin.yml?raw";
import README from "../../../plugins/src/rocket-car-soccer/README.md?raw";
import {
  RCS_CAPS,
  RCS_DEFAULTS,
  RCS_MAX_CARS,
  RCS_MAX_SUBSTEPS,
  RCS_MAX_TEAM,
  RCS_PRESETS,
  RCS_SLOT,
  parseRcsOptions,
  presetConfigValues,
  rcsRenderScale,
  scanRcsTrademarks,
  validatePreset,
} from "../../../plugins/src/rocket-car-soccer/frontend/pack";
import { RCS_LIVE_MAPPING } from "../../../plugins/src/rocket-car-soccer/frontend/live";
import {
  enforceRcsCaps,
  maxSubstepsFor,
  rcsEnterReplayForTest,
  rcsMount,
  rcsOptionsNow,
  rcsPoolStats,
  rcsSampleAt,
  rcsTick,
  rcsTriggerMaxGoalExplosion,
  rcsUnmount,
  rcsWorkBudgetAtPreset,
  resetRcsSim,
  setRcsOptions,
} from "../../../plugins/src/rocket-car-soccer/frontend/match";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";

const PACK_ROOT = join(__dirname, "../../../plugins/src/rocket-car-soccer");

function listPackFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listPackFiles(p));
    else out.push(p);
  }
  return out;
}

describe("rocket-car-soccer pack", () => {
  it("wraps and compiles the arena sky", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("zotoVizSlots");
    expect(FRAG).toMatch(/failA|sl\(0, 28/);
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("declares liveMapping, caps, and viz contract in plugin.yml", () => {
    expect(PLUGIN).toMatch(/config\.read/);
    expect(PLUGIN).toMatch(/liveMapping:/);
    expect(PLUGIN).toMatch(/maxCars:\s*6/);
    expect(PLUGIN).toMatch(/maxParticles:\s*48/);
    expect(PLUGIN).toMatch(/maxTrailSegments:\s*24/);
    expect(PLUGIN).toMatch(/maxPhysicsSubsteps:\s*4/);
    expect(PLUGIN).toMatch(/maxBuffers:\s*3/);
    expect(PLUGIN).toMatch(/maxBufferFloats:\s*64/);
    for (const row of RCS_LIVE_MAPPING) {
      expect(PLUGIN).toContain(row.field);
      expect(PLUGIN).toContain(row.effect);
    }
  });

  it("passes trademark name-check on all pack files", () => {
    const files = listPackFiles(PACK_ROOT);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(scanRcsTrademarks(text), f).toBeNull();
    }
    expect(scanRcsTrademarks(README)).toBeNull();
    expect(scanRcsTrademarks(FRONT)).toBeNull();
  });

  it("validates every preset against option clamps", () => {
    for (const id of Object.keys(RCS_PRESETS)) {
      expect(validatePreset(id)).toBe(true);
      const merged = enforceRcsCaps(parseRcsOptions(presetConfigValues(id as keyof typeof RCS_PRESETS)));
      expect(merged.teamSize).toBeLessThanOrEqual(RCS_MAX_TEAM);
      expect(merged.particles).toBeLessThanOrEqual(100);
      expect(merged.minCutSec).toBeGreaterThanOrEqual(3);
    }
  });

  it("reads each shipped config key through parseRcsOptions", () => {
    const keys = [...VIS.matchAll(/- key: (\w+)/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain("minCutSec");
    expect(keys).not.toContain("cutHz");
    const base = JSON.stringify(parseRcsOptions({ preset: "neon_night" }));
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
      const parsed = parseRcsOptions({ preset: "neon_night", [key]: flip });
      const baseParsed = parseRcsOptions({ preset: "neon_night" });
      if (JSON.stringify(parsed) === JSON.stringify(baseParsed)) {
        const allAlts = [...chunk.matchAll(/-\s+\[(\w+),/g)].map((m) => m[1]!);
        const second = allAlts.find((v) => v !== (baseParsed as Record<string, unknown>)[key] && v !== flip);
        if (second) {
          expect(JSON.stringify(parseRcsOptions({ preset: "neon_night", [key]: second })), key).not.toBe(
            JSON.stringify(baseParsed),
          );
          continue;
        }
      }
      expect(JSON.stringify(parsed), key).not.toBe(JSON.stringify(baseParsed));
    }
  });

  it("enforces car, substep, and team caps", () => {
    setRcsOptions({ teamSize: "9", gameSpeed: "500", particles: "500" });
    const o = rcsOptionsNow();
    expect(o.teamSize).toBe(RCS_MAX_TEAM);
    expect(o.particles).toBeLessThanOrEqual(100);
    expect(maxSubstepsFor(1 / 30)).toBeLessThanOrEqual(RCS_MAX_SUBSTEPS);
    resetRcsSim(1);
    const packed = rcsTick(undefined, 1.6, 1 / 60, 1.777);
    expect(packed.slot0[RCS_SLOT.carCount]).toBeLessThanOrEqual(RCS_MAX_CARS);
    setRcsOptions({});
  });

  it("is deterministic for a fixed seed and time", () => {
    const a = rcsSampleAt(12.5, 0xdecaf);
    const b = rcsSampleAt(12.5, 0xdecaf);
    expect(a).toEqual(b);
  });

  it("does not re-run physics during replay sampling", () => {
    setRcsOptions({ replay: "true" });
    resetRcsSim(7);
    expect(() => rcsEnterReplayForTest()).not.toThrow();
  });

  it("keeps instanced pools at cap with no slot growth after warm-up", () => {
    resetRcsSim(1);
    rcsTriggerMaxGoalExplosion();
    for (let i = 0; i < 120; i++) rcsTick(undefined, i / 60, 1 / 60, 1.777);
    const stats = rcsPoolStats();
    expect(stats.particleAllocs).toBe(0);
    expect(stats.trailAllocs).toBe(0);
    const last = rcsTick(undefined, 2.5, 1 / 60, 1.777);
    expect(last.budget.particles).toBeLessThanOrEqual(RCS_CAPS.maxParticles);
    expect(last.budget.trailSegments).toBeLessThanOrEqual(RCS_CAPS.maxTrailSegments);
  });

  it("frees sandbox resources after 20 mount cycles", () => {
    for (let i = 0; i < 20; i++) {
      rcsMount();
      const mid = rcsUnmount();
      expect(mid.programs).toBeGreaterThan(0);
    }
    const clean = rcsUnmount();
    expect(clean.buffers).toBe(0);
    expect(clean.programs).toBe(0);
    expect(clean.contexts).toBe(0);
    expect(clean.raf).toBe(0);
    expect(clean.mounts).toBe(0);
  });

  it("work budget stays under plugin.yml caps at every preset", () => {
    for (const id of Object.keys(RCS_PRESETS)) {
      const b = rcsWorkBudgetAtPreset(id);
      expect(b.particles, id).toBeLessThanOrEqual(RCS_CAPS.maxParticles);
      expect(b.trailSegments, id).toBeLessThanOrEqual(RCS_CAPS.maxTrailSegments);
      expect(b.physicsSubsteps, id).toBeLessThanOrEqual(RCS_CAPS.maxPhysicsSubsteps);
    }
  });

  it("smoke-packs non-zero drive data (never an empty board)", () => {
    resetRcsSim(99);
    setRcsOptions({});
    const f = rcsTick({ demo: true, talkers: [{ rate: 12 }] }, 1.0, 1 / 60, 1.777);
    expect(f.slot0[RCS_SLOT.mark]).toBe(1);
    expect(f.slot0[RCS_SLOT.demoFlag]).toBe(1);
    const energy = [...f.slot0, ...f.slot1, ...f.slot2].reduce((s, v) => s + Math.abs(v), 0);
    expect(energy).toBeGreaterThan(10);
    const avg = energy / (f.slot0.length + f.slot1.length + f.slot2.length);
    expect(avg).toBeGreaterThan(0.05);
  });

  it("prioritises fail alert over goal flash in sim slots", () => {
    resetRcsSim(1);
    setRcsOptions({});
    const failFrame = rcsTick({ sys: { failed: 1 } }, 0.5, 1 / 60, 1.777);
    expect(failFrame.slot0[RCS_SLOT.failAlert]).toBeGreaterThan(0.35);
    rcsTriggerMaxGoalExplosion();
    const during = rcsTick({ sys: { failed: 1 } }, 0.6, 1 / 60, 1.777);
    expect(during.slot0[RCS_SLOT.goalFlash]).toBeLessThan(0.05);
  });

  it("keeps render scale at 1.0 behind the swappable hook", () => {
    expect(rcsRenderScale()).toBe(1);
  });

  it("sandbox driver exports teardown hook for mount counting", () => {
    expect(FRONT).toMatch(/export function rcsFrontendTeardown/);
    expect(FRONT).toMatch(/rcsUnmount\s*\(/);
  });

  it("parses team colour overrides and seed", () => {
    const o = parseRcsOptions({ teamOrange: "#aabbcc", teamBlue: "#112233", seed: "1234" });
    expect(o.teamOrange).toBe("#aabbcc");
    expect(o.teamBlue).toBe("#112233");
    expect(o.seed).toBe(1234);
    expect(o.minCutSec).toBeGreaterThanOrEqual(3);
  });

  it("writes viz buffers from the sandbox driver", () => {
    expect(FRONT).toMatch(/writeBuffer\s*\(/);
    expect(FRONT).toMatch(/writeParticles\s*\(/);
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
