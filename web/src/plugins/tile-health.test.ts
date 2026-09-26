import { describe, expect, it } from "vitest";
import {
  HEAL_LADDER,
  TILE_EMPTY_STREAK,
  TILE_HEAL_OK_STREAK,
  TilePatchSampler,
  classifyTileEmpty,
  freshTileHealthState,
  patchIsNearUniform,
  patchOrigin,
  stepTileHealth,
  healMessage,
} from "./tile-health";
import { readTileHealErrors, writeTileHealErrors } from "./tile-health-monitor";

function rgbaFill(r: number, g: number, b: number, n = 16 * 16): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function noisyPatch(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) {
    const v = (i * 37 + (i % 5) * 11) % 40;
    out[i * 4] = 8 + v;
    out[i * 4 + 1] = 12 + v;
    out[i * 4 + 2] = 18 + v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe("patchIsNearUniform", () => {
  it("flags solid black, grey, and flat colour", () => {
    expect(patchIsNearUniform(rgbaFill(0, 0, 0))).toBe(true);
    expect(patchIsNearUniform(rgbaFill(40, 40, 40))).toBe(true);
    expect(patchIsNearUniform(rgbaFill(0, 80, 200))).toBe(true);
  });

  it("passes a dark patch with detail", () => {
    expect(patchIsNearUniform(noisyPatch())).toBe(false);
  });
});

describe("classifyTileEmpty", () => {
  const base = {
    patch: noisyPatch(),
    lastCheckPictureSerial: 1,
    signals: {
      mayBeStatic: false,
      contextLost: false,
      pictureSerial: 2,
      dataFramesArriving: true,
      drawingNothing: false,
    },
  };

  it("detects uniform, stall, context loss, and drawing nothing", () => {
    expect(classifyTileEmpty({ ...base, patch: rgbaFill(0, 0, 0) })).toBe("uniform");
    expect(classifyTileEmpty({
      ...base,
      signals: { ...base.signals, pictureSerial: 1 },
    })).toBe("stalled");
    expect(classifyTileEmpty({
      ...base,
      signals: { ...base.signals, contextLost: true },
    })).toBe("context-lost");
    expect(classifyTileEmpty({
      ...base,
      signals: { ...base.signals, drawingNothing: true },
    })).toBe("drawing-nothing");
  });

  it("skips stillness when mayBeStatic is set", () => {
    expect(classifyTileEmpty({
      ...base,
      signals: { ...base.signals, mayBeStatic: true, pictureSerial: 1 },
    })).toBeNull();
  });
});

describe("stepTileHealth ladder", () => {
  const patch = rgbaFill(0, 0, 0);
  const signals = {
    mayBeStatic: false,
    contextLost: false,
    pictureSerial: 0,
    dataFramesArriving: true,
    drawingNothing: false,
  };

  it("walks the heal ladder in order", () => {
    let state = freshTileHealthState();
    const steps: string[] = [];
    let t = 0;
    for (let round = 0; round < HEAL_LADDER.length; round++) {
      for (let i = 0; i < TILE_EMPTY_STREAK; i++) {
        t += 2000;
        const out = stepTileHealth(state, t, {
          patch,
          lastCheckPictureSerial: state.lastCheckPictureSerial,
          signals,
        }, "tile-a", "pack-a");
        state = out.state;
        if (out.heal) steps.push(out.heal);
      }
      t += 20000;
      state.backoffUntil = 0;
      state.healTimes = [];
      state.pinnedFallback = false;
    }
    expect(steps).toEqual([...HEAL_LADDER]);
  });

  it("clamps patch origin in framebuffer space for offset viewports", () => {
    const { x, y } = patchOrigin({ x: 40, y: 20, w: 100, h: 80 }, 16);
    expect(x).toBe(82);
    expect(y).toBe(52);
  });

  it("pins to fallback after three heals in ten minutes", () => {
    let state = freshTileHealthState();
    let t = 0;
    const heals: string[] = [];
    for (let h = 0; h < 4; h++) {
      for (let i = 0; i < TILE_EMPTY_STREAK; i++) {
        t += 2000;
        const out = stepTileHealth(state, t, {
          patch,
          lastCheckPictureSerial: state.lastCheckPictureSerial,
          signals,
        }, "t", "p");
        state = out.state;
        if (out.heal) heals.push(out.heal);
      }
      t += 100;
      state.healthyStreak = 0;
      state.emptyStreak = 0;
    }
    expect(heals).toContain("fallback-pack");
    expect(state.pinnedFallback).toBe(true);
    expect(heals.length).toBeGreaterThanOrEqual(3);
    const afterPin = stepTileHealth(state, t + 6000, {
      patch,
      lastCheckPictureSerial: state.lastCheckPictureSerial,
      signals,
    }, "t", "p");
    expect(afterPin.heal).toBeNull();
  });

  it("resets ladder after three healthy checks", () => {
    let state = freshTileHealthState();
    state.ladderIndex = 3;
    let t = 0;
    for (let i = 0; i < TILE_HEAL_OK_STREAK; i++) {
      t += 2000;
      const out = stepTileHealth(state, t, {
        patch: noisyPatch(),
        lastCheckPictureSerial: state.lastCheckPictureSerial,
        signals: { ...signals, pictureSerial: i + 1 },
      }, "t", "p");
      state = out.state;
    }
    expect(state.ladderIndex).toBe(0);
  });
});

describe("TilePatchSampler allocation", () => {
  it("reuses the same scratch buffer instance", () => {
    const sampler = new TilePatchSampler(16);
    const first = sampler.scratchBuffer;
    for (let i = 0; i < 300; i++) {
      first[i % first.length] = i & 255;
    }
    expect(sampler.scratchBuffer).toBe(first);
    expect(sampler.scratchBuffer.byteLength).toBe(16 * 16 * 4);
  });
});

describe("tile heal messages", () => {
  it("formats user-facing copy", () => {
    expect(healMessage("uniform", "restart-pack", 6000)).toMatch(/blank for 6 s, restarted pack/);
  });
});

describe("tile heal errors setting", () => {
  it("defaults off and persists", () => {
    localStorage.removeItem("zoto-viz.tileHealErrors");
    expect(readTileHealErrors()).toBe(false);
    writeTileHealErrors(true);
    expect(readTileHealErrors()).toBe(true);
    writeTileHealErrors(false);
  });
});
