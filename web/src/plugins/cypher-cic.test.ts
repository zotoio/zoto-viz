import { describe, expect, it } from "vitest";
import {
  CANVAS_DEFAULT, cicCanvasSize, clamp01, DEFAULT_LOOK, EMPTY_SYS, idHash,
  packPackets, packRf, packSysSlot, packTalkers, parseCicLook, peakRf, peakTalker,
  roleCode, sysAlert,
} from "../../../plugins/src/cypher-cic/frontend/pack";

describe("cypher-cic pack", () => {
  it("packs gauges, canvas, look, and load into slot 0", () => {
    const buf = packSysSlot(
      { ...EMPTY_SYS, cpu: 0.4, mem: 0.8, failed: 0.5, temp: 0.9 },
      0.25,
      { w: 1353, h: 786 },
      { rain: 1.2, glitch: 0.4, hud: 0.9 },
      0.6,
      0.3,
    );
    expect(buf).toHaveLength(19);
    expect(buf[0]).toBeCloseTo(0.4);
    expect(buf[1]).toBeCloseTo(0.8);
    expect(buf[8]).toBeCloseTo(0.5);
    expect(buf[10]).toBeCloseTo(0.25);
    expect(buf[11]).toBeCloseTo(0.9);
    expect(buf[12]).toBe(1353);
    expect(buf[13]).toBe(786);
    expect(buf[14]).toBeCloseTo(0.6);
    expect(buf[15]).toBeCloseTo(0.3);
    expect(buf[16]).toBeCloseTo(1.2);
    expect(buf[17]).toBeCloseTo(0.4);
    expect(buf[18]).toBeCloseTo(0.9);
  });

  it("clamps missing sys as zeros and defaults the plate", () => {
    expect(packSysSlot(undefined, 2)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1280, 800, 0, 0,
      DEFAULT_LOOK.rain, DEFAULT_LOOK.glitch, DEFAULT_LOOK.hud,
    ]);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(sysAlert({ ...EMPTY_SYS, psi: 0.3, temp: 0.2 })).toBeCloseTo(0.3);
  });

  it("packs talkers, packets, and RF beacons", () => {
    const talk = packTalkers([
      { id: "10.0.0.1", rate: 100, role: "lan" },
      { id: "1.1.1.1", rate: 400, role: "internet" },
    ]);
    expect(talk).toHaveLength(8);
    expect(talk[0]).toBeCloseTo(0.5);
    expect(talk[2]).toBeCloseTo(0.45);
    expect(talk[4]).toBe(1);
    expect(talk[6]).toBeCloseTo(0.75);

    const pk = packPackets([{ proto: "tcp", size: 750, field: 0.4 }]);
    expect(pk).toHaveLength(4);
    expect(pk[0]).toBeCloseTo(0.4);
    expect(pk[1]).toBeCloseTo(0.5);
    expect(pk[2]).toBeCloseTo(idHash("tcp"));

    const rf = packRf([{ ssid: "mesh", rssi: -30, channel: 36 }]);
    expect(rf).toHaveLength(4);
    expect(rf[0]).toBeCloseTo(1);
    expect(rf[1]).toBeCloseTo(36 / 165);
  });

  it("parses look knobs and canvas fallback", () => {
    expect(parseCicLook({ rain: "1.5", glitch: "2", hud: "0.1" })).toEqual({
      rain: 1.5, glitch: 1, hud: 0.35,
    });
    expect(peakTalker([{ id: "a", rate: 100, role: "lan" }])).toBeCloseTo(0.5);
    expect(peakRf([{ ssid: "x", rssi: -30, channel: 1 }])).toBeCloseTo(1);
    expect(roleCode("gateway")).toBeCloseTo(0.95);
    expect(roleCode("self")).toBe(1);
    const fake = { querySelector: () => null } as unknown as Document;
    expect(cicCanvasSize(fake)).toEqual(CANVAS_DEFAULT);
  });
});
