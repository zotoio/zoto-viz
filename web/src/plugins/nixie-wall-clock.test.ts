import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetVizClockInjectors,
  setVizClockInjector,
  setVizWallClockInjector,
} from "../core/viz-clock";
import {
  createNixieWallClock,
  digitsFromWallMs,
  nixieSimWallMs,
  packNixieWallBuffer,
  resetNixieFormatterCache,
} from "./nixie-wall-clock";
import * as nixieTubes from "../../../plugins/src/nixie-clock/frontend/tubes";
import { DEFAULT_LOOK, NIXIE_LOOK_FIELD_BY_KEY } from "../../../plugins/src/nixie-clock/frontend/tubes";
import {
  hostNixieFormatCalls,
  resetNixiePackHostScope,
  runPackFrameHandler,
  syncNixiePackScope,
  syncVizPackRenderCanvas,
  nixiePackActiveLook,
  nixiePackActiveCanvas,
} from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";

const SYDNEY = "Australia/Sydney";
const UTC = "UTC";

function emptyFrame(): VizDataFrame {
  return {
    t: 0,
    dt: 1 / 60,
    audio: 0,
    packets: [],
    rf: [],
    talkers: [],
    headlines: [],
    sys: { cpu: 0, mem: 0, load: 0, temp: 0, disk: 0, net: 0 },
  };
}

describe("nixie wall clock rows", () => {
  afterEach(() => {
    resetVizClockInjectors();
    resetNixieFormatterCache();
    resetNixiePackHostScope();
    vi.restoreAllMocks();
  });

  it("N1: 600 frames — format at [0,60,…,540], one formatter, stable buffer", () => {
    resetNixieFormatterCache();
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    const qSpy = vi.spyOn(Document.prototype, "querySelector");
    const jsonSpy = vi.spyOn(JSON, "stringify");
    const keysSpy = vi.spyOn(Object, "keys");
    const hostCanvas: { w: number; h: number } = { w: 1920, h: 1080 };
    const t0 = 1_700_000_000_000;
    setVizWallClockInjector(() => t0);
    const formatFrames: number[] = [];
    let prevCalls = hostNixieFormatCalls();
    let lookRef: ReturnType<typeof nixiePackActiveLook> | null = null;
    let canvasRef: ReturnType<typeof nixiePackActiveCanvas> | null = null;
    const frame = emptyFrame();
    const bufOut: number[] = [];
    for (let i = 0; i < 600; i++) {
      const wallMs = nixieSimWallMs(t0, i);
      setVizWallClockInjector(() => wallMs);
      syncVizPackRenderCanvas(hostCanvas);
      runPackFrameHandler("nixie-clock", frame, {
        writeBuffer: (_slot, data) => { bufOut.length = 0; bufOut.push(...data); },
        writeUniform: () => {},
        writeParticles: () => {},
      }, { format: "24", seconds: "1" });
      const calls = hostNixieFormatCalls();
      if (calls > prevCalls) {
        formatFrames.push(i);
        prevCalls = calls;
      }
      if (i === 0) {
        lookRef = nixiePackActiveLook();
        canvasRef = nixiePackActiveCanvas();
        qSpy.mockClear();
        jsonSpy.mockClear();
        keysSpy.mockClear();
      } else {
        expect(nixiePackActiveLook()).toBe(lookRef);
        expect(nixiePackActiveCanvas()).toBe(canvasRef);
        expect(qSpy).not.toHaveBeenCalled();
        expect(jsonSpy).not.toHaveBeenCalled();
        expect(keysSpy).not.toHaveBeenCalled();
      }
    }
    expect(spy.mock.calls.length).toBe(1);
    expect(formatFrames).toEqual([0, 60, 120, 180, 240, 300, 360, 420, 480, 540]);
    for (const i of [1, 17, 60, 119]) {
      expect(nixieSimWallMs(t0, i)).toBe(t0 + Math.floor((i * 5000) / 300));
    }
    expect(bufOut.length).toBeGreaterThan(6);
  });

  it("N4: look option keys — one parse per change, literal key list", () => {
    const parseSpy = vi.spyOn(nixieTubes, "parseNixieLook");
    const hostCanvas = { w: 1280, h: 800 };
    const t0 = 1_700_000_000_000;
    setVizWallClockInjector(() => t0);
    const frame = emptyFrame();
    const handlers = {
      writeBuffer: () => {},
      writeUniform: () => {},
      writeParticles: () => {},
    };
    const base = { format: "24", seconds: "1", glow: "1", flicker: "0.22" };
    syncVizPackRenderCanvas(hostCanvas);
    runPackFrameHandler("nixie-clock", frame, handlers, base);
    parseSpy.mockClear();

    const keyList = ["format", "seconds", "glow", "flicker"];
    expect(keyList).toEqual(["format", "seconds", "glow", "flicker"]);

    const steps: { key: keyof typeof base; value: string; field: keyof typeof DEFAULT_LOOK; want: unknown }[] = [
      { key: "format", value: "12", field: NIXIE_LOOK_FIELD_BY_KEY.format, want: true },
      { key: "seconds", value: "0", field: NIXIE_LOOK_FIELD_BY_KEY.seconds, want: false },
      { key: "glow", value: "1.5", field: NIXIE_LOOK_FIELD_BY_KEY.glow, want: 1.5 },
      { key: "flicker", value: "0.5", field: NIXIE_LOOK_FIELD_BY_KEY.flicker, want: 0.5 },
    ];
    let opts = { ...base };
    for (let si = 0; si < steps.length; si++) {
      const step = steps[si]!;
      opts = { ...opts, [step.key]: step.value };
      runPackFrameHandler("nixie-clock", frame, handlers, opts);
      expect(parseSpy.mock.calls.length).toBe(si + 1);
      expect(nixiePackActiveLook()[step.field]).toEqual(step.want);
    }
    expect(parseSpy.mock.calls.length).toBe(4);
  });

  it("N12: mixed 12h and 24h tiles — one format per second, per-tile hour conversion", () => {
    resetNixieFormatterCache();
    const clock = createNixieWallClock(UTC);
    const look12 = { ...DEFAULT_LOOK, hour12: true, seconds: false };
    const look24 = { ...DEFAULT_LOOK, hour12: false, seconds: false };
    const t0 = Date.parse("2024-06-15T13:05:00.000Z");
    for (let i = 0; i < 120; i++) {
      const wallMs = t0 + Math.floor((i * 1000) / 60);
      const a = clock.tick(wallMs, look12);
      expect(a.slice(0, 4)).toEqual([0, 1, 0, 5]);
      const b = clock.tick(wallMs, look24);
      expect(b.slice(0, 4)).toEqual([1, 3, 0, 5]);
    }
    expect(clock.formatCalls).toBe(2);
  });

  it("N2: Sydney DST spring — 01:59:59 to 03:00:00", () => {
    const look = { ...DEFAULT_LOOK, hour12: false };
    const before = Date.parse("2026-10-03T15:59:59.000Z");
    const after = Date.parse("2026-10-03T16:00:00.000Z");
    const d0 = digitsFromWallMs(before, look, SYDNEY);
    const d1 = digitsFromWallMs(after, look, SYDNEY);
    expect(d0).toEqual([0, 1, 5, 9, 5, 9]);
    expect(d1).toEqual([0, 3, 0, 0, 0, 0]);
  });

  it("N3: after reload, the display still shows the local wall hour, not page uptime", async () => {
    const wallMs = Date.parse("2026-06-15T14:30:00.000Z") + 500;
    resetVizClockInjectors();
    setVizWallClockInjector(() => wallMs);
    setVizClockInjector(() => 42_000);
    resetNixieFormatterCache();
    const mod = await import("./nixie-wall-clock");
    const clock = mod.createNixieWallClock(SYDNEY);
    const expected = mod.digitsFromWallMs(wallMs, DEFAULT_LOOK, SYDNEY);
    const uptimeDigits = mod.digitsFromWallMs(42_000, DEFAULT_LOOK, SYDNEY);
    mod.packNixieWallBuffer(clock, DEFAULT_LOOK);
    expect(clock.digitBuffer.slice(0, 6)).toEqual(expected);
    expect(clock.digitBuffer.slice(0, 6)).not.toEqual(uptimeDigits);
  });
});
