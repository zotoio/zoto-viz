import { afterEach, describe, expect, it, vi } from "vitest";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import {
  DEMO_CELLS, DEMO_LINKS, KIND_BLUETOOTH, KIND_NETWORK, KIND_WIFI, LumenReef, REEF_SPRINGS, reefKind,
  type ReefCellInput, type ReefLinkInput,
} from "./reef";

const cellsOf = (roles: string[]): ReefCellInput[] =>
  roles.map((role, i) => ({ id: `d${i}`, x: -0.8 + i * 0.4, y: i % 2 ? 0.3 : -0.3, r: 0.2, role, rate: 10 + i }));

describe("Lumen Reef simulation", () => {
  it("maps roles to connection types", () => {
    expect(reefKind("lan")).toBe(KIND_NETWORK);
    expect(reefKind("gateway")).toBe(KIND_NETWORK);
    expect(reefKind("wifi")).toBe(KIND_WIFI);
    expect(reefKind("lan", "rf:home")).toBe(KIND_WIFI);
    expect(reefKind("bluetooth")).toBe(KIND_BLUETOOTH);
  });

  it("every cell of every connection type keeps moving over N ticks, smoothly (no jumps)", () => {
    const reef = new LumenReef();
    const cells = cellsOf(["lan", "wifi", "bluetooth", "gateway"]);
    const dt = 1 / 30;
    for (let i = 0; i < 90; i++) reef.step(dt, cells, []); // settle in
    const path: number[][] = [[], [], [], []];
    let maxStep = 0;
    let prevX = Array.from(reef.slotCells.slice(0, 16));
    for (let n = 0; n < 300; n++) {
      reef.step(dt, cells, []);
      for (let i = 0; i < 4; i++) {
        path[i]!.push(reef.slotCells[i * 4]!, reef.slotCells[i * 4 + 1]!);
        maxStep = Math.max(maxStep, Math.hypot(reef.slotCells[i * 4]! - prevX[i * 4]!, reef.slotCells[i * 4 + 1]! - prevX[i * 4 + 1]!));
      }
      prevX = Array.from(reef.slotCells.slice(0, 16));
    }
    for (let i = 0; i < 4; i++) {
      const xs = path[i]!.filter((_, k) => k % 2 === 0);
      expect(Math.max(...xs) - Math.min(...xs), `cell ${i} travels`).toBeGreaterThan(0.03);
    }
    expect(maxStep, "calm: under 0.02 units per 1/30 s").toBeLessThan(0.02);
  });

  it("Bluetooth is looser than Wi-Fi, which is looser than wired network", () => {
    expect(REEF_SPRINGS[KIND_BLUETOOTH].k).toBeLessThan(REEF_SPRINGS[KIND_WIFI].k);
    expect(REEF_SPRINGS[KIND_WIFI].k).toBeLessThan(REEF_SPRINGS[KIND_NETWORK].k);
    expect(REEF_SPRINGS[KIND_NETWORK].zeta).toBeGreaterThanOrEqual(1);
    expect(REEF_SPRINGS[KIND_BLUETOOTH].linkTau).toBeGreaterThan(REEF_SPRINGS[KIND_NETWORK].linkTau);
  });

  it("links ease in and fade out instead of popping; cells fade too", () => {
    const reef = new LumenReef();
    const cells = cellsOf(["lan", "gateway"]);
    const link: ReefLinkInput[] = [{ src: "d0", dst: "d1", rate: 50 }];
    reef.step(1 / 30, cells, link);
    const first = reef.slotBridges[2]!;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.1);
    let last = first;
    for (let i = 0; i < 120; i++) {
      reef.step(1 / 30, cells, link);
      const s = reef.slotBridges[2]!;
      expect(s - last).toBeLessThan(0.06);
      last = s;
    }
    expect(last).toBeGreaterThan(0.5);
    for (let i = 0; i < 30; i++) reef.step(1 / 30, cells, []);
    expect(reef.slotBridges[2]!).toBeLessThan(last);
    expect(reef.slotBridges[2]!).toBeGreaterThan(0.05);
    reef.step(1 / 30, [], []);
    expect(reef.slotCells[32]!, "cell fades, not gone at once").toBeGreaterThan(0.5);
    for (let i = 0; i < 300; i++) reef.step(1 / 30, [], []);
    expect(reef.ids.every((id) => id === null)).toBe(true);
  });

  it("clamps dt so a stalled tab does not kick the springs", () => {
    const reef = new LumenReef();
    const cells = cellsOf(["bluetooth"]);
    reef.step(1 / 30, cells, []);
    const x0 = reef.slotCells[0]!;
    reef.step(30, cells, []);
    expect(Math.abs(reef.slotCells[0]! - x0)).toBeLessThan(0.05);
    reef.step(Number.NaN, cells, []);
    expect(Number.isFinite(reef.slotCells[0]!)).toBe(true);
  });

  it("reuses its buffers every frame and dispose clears every slot", () => {
    const reef = new LumenReef();
    const a = reef.slotCells;
    const b = reef.slotBridges;
    for (let i = 0; i < 20; i++) reef.step(1 / 30, DEMO_CELLS, DEMO_LINKS, true);
    expect(reef.slotCells).toBe(a);
    expect(reef.slotBridges).toBe(b);
    expect(reef.slotMeta[0]).toBe(1);
    expect(reef.slotMeta[1]).toBe(1);
    reef.dispose();
    expect(Array.from(reef.slotCells).every((v) => v === 0)).toBe(true);
    expect(Array.from(reef.slotBridges).every((v) => v === 0)).toBe(true);
    expect(reef.slotMeta[0]).toBe(0);
    expect(reef.ids.every((id) => id === null)).toBe(true);
  });
});

type FakeHost = {
  writeBuffer: ReturnType<typeof vi.fn>;
  writeUniform: ReturnType<typeof vi.fn>;
  onFrame?: (f: VizDataFrame) => void;
};

const frameAt = (t: number, talkers: VizDataFrame["talkers"]): VizDataFrame => ({
  t, dt: 1 / 30, audio: 0.2, packets: [], rf: [], talkers, headlines: [],
});

describe("blob-mesh pack writes a moving reef", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "zoto");
    vi.resetModules();
  });

  for (const [name, talkers] of [
    ["live LAN", [
      { id: "192.168.1.1", rate: 90, role: "gateway" },
      { id: "192.168.1.20", rate: 40, role: "lan" },
      { id: "phone", rate: 12, role: "wifi" },
      { id: "buds", rate: 3, role: "bluetooth" },
    ]],
    ["idle (demo reef)", []],
  ] as const) {
    it(`${name}: slots 1 to 3 advance over N frames`, async () => {
      const host: FakeHost = { writeBuffer: vi.fn(), writeUniform: vi.fn() };
      Reflect.set(globalThis, "zoto", host);
      await import("./index");
      const seen = new Map<number, Set<string>>();
      for (let i = 0; i < 60; i++) {
        host.onFrame?.(frameAt(1 + i / 30, [...talkers]));
        for (const [slot, data] of host.writeBuffer.mock.calls) {
          if (typeof slot !== "number") continue;
          if (!seen.has(slot)) seen.set(slot, new Set());
          seen.get(slot)?.add(Array.prototype.join.call(data, ","));
        }
        host.writeBuffer.mockClear();
      }
      expect([...seen.keys()].sort()).toEqual([0, 1, 2, 3]);
      expect(seen.get(1)!.size, "cells move every frame").toBeGreaterThan(50);
      expect(seen.get(2)!.size, "bridges ease").toBeGreaterThan(5);
    });
  }
});
