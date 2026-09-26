import { describe, expect, it } from "vitest";
import { runPackOnFixtures } from "../../../plugins/sdk/viz-fixtures";
import { clamp01, EMPTY_SYS_GAUGES, packSysGauges, sysAlert, sysconCanvasSize } from "../../../plugins/src/syscon/frontend/telemetry";

describe("syscon gauges", () => {
  it("packs shared host fixtures into slot 0", () => {
    runPackOnFixtures((frame) => {
      const buf = packSysGauges(frame.sys ?? EMPTY_SYS_GAUGES, frame.audio, sysconCanvasSize());
      expect(buf.length).toBeGreaterThan(0);
    });
  });

  it("packs gauges plus canvas size", () => {
    const buf = packSysGauges({
      ...EMPTY_SYS_GAUGES,
      cpu: 0.4,
      mem: 0.8,
      failed: 0.5,
      temp: 0.9,
    }, 0.25, { w: 1353, h: 786 });
    expect(buf).toHaveLength(14);
    expect(buf[0]).toBeCloseTo(0.4);
    expect(buf[1]).toBeCloseTo(0.8);
    expect(buf[8]).toBeCloseTo(0.5);
    expect(buf[10]).toBeCloseTo(0.25);
    expect(buf[11]).toBeCloseTo(0.9);
    expect(buf[12]).toBe(1353);
    expect(buf[13]).toBe(786);
  });

  it("clamps and treats missing sys as zeros", () => {
    expect(packSysGauges(undefined, 2)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1280, 800,
    ]);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(sysAlert({ ...EMPTY_SYS_GAUGES, psi: 0.3, temp: 0.2 })).toBeCloseTo(0.3);
  });

  it("falls back to the default plate when no canvas is present", () => {
    const fake = { querySelector: () => null } as unknown as Document;
    expect(sysconCanvasSize(fake)).toEqual({ w: 1280, h: 800 });
  });
});
