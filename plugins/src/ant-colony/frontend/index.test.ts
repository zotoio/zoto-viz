import { describe, expect, it } from "vitest";
import {
  EMPTY_SYS_TELEMETRY,
  type VizDataFrame,
  type VizSysTelemetry,
} from "../../../sdk/viz-contract";
import {
  ANT_DATA_MAPPING,
  ANT_WORK_BUDGET,
  NEST_ENTRANCE,
  cycleColonyTeardown,
  parseAntColonyLook,
  AntColonySim,
  PG_CELLS,
  createColony,
} from "./index";

const EMPTY_SYS: VizSysTelemetry = EMPTY_SYS_TELEMETRY;

/** Frame slices here leave out rf/headlines (the colony never reads them); they default to empty. */
function frame(slice: Omit<VizDataFrame, "rf" | "headlines"> & Partial<Pick<VizDataFrame, "rf" | "headlines">>): VizDataFrame {
  return { rf: [], headlines: [], ...slice };
}

describe("ant-colony pack", () => {
  it("validates presets and mapping metadata", () => {
    const look = parseAntColonyLook({ preset: "night-glow", antCap: "200", seed: "1" });
    expect(look.preset).toBe("night-glow");
    expect(look.antCap).toBe(160);
    expect(ANT_DATA_MAPPING.length).toBeGreaterThanOrEqual(4);
    expect(ANT_WORK_BUDGET.instances).toBeGreaterThanOrEqual(look.antCap);
    expect(parseAntColonyLook({ seed: "0" }).seed).toBe(0);
  });

  it("keeps work counts under caps for every preset", () => {
    for (const preset of ["formicarium", "night-glow", "red-alert", "minimal"] as const) {
      const sim = createColony(parseAntColonyLook({ preset, seed: "42" }));
      for (let i = 0; i < 30; i++) {
        sim.tick(frame({
          t: i / 30,
          dt: 1 / 60,
          audio: 0.2,
          packets: [{ proto: "udp", size: 200, field: 0.5 }],
          talkers: [{ id: "hub", rate: 120, role: "gateway" }],
          sys: { ...EMPTY_SYS, failed: preset === "red-alert" ? 0.4 : 0 },
        }));
      }
      const { instances, drawCalls } = sim.workCounts();
      expect(instances).toBeLessThanOrEqual(ANT_WORK_BUDGET.instances);
      expect(drawCalls).toBeLessThanOrEqual(ANT_WORK_BUDGET.drawCalls);
      sim.dispose();
    }
  });

  it("pheromone grid matches packed slot capacity", () => {
    expect(PG_CELLS).toBe(256);
  });

  it("is deterministic for a pinned seed", () => {
    const a = createColony(parseAntColonyLook({ seed: "9001" }));
    const b = createColony(parseAntColonyLook({ seed: "9001" }));
    const tickFrame = frame({
      t: 2,
      dt: 1 / 60,
      audio: 0,
      packets: [{ proto: "tcp", size: 80, field: 0.3 }],
      talkers: [{ id: "x", rate: 90, role: "lan" }, { id: "y", rate: 40, role: "lan" }],
    });
    for (let i = 0; i < 20; i++) {
      a.tick(tickFrame);
      b.tick(tickFrame);
    }
    expect(a.packSlots(tickFrame)[0]).toEqual(b.packSlots(tickFrame)[0]);
    a.dispose();
    b.dispose();
  });

  it("teardown frees sim after many cycles", () => {
    cycleColonyTeardown(20);
    const sim = new AntColonySim(parseAntColonyLook({}));
    sim.dispose();
    expect(sim.warmAllocCheck()).toBe(false);
  });

  it("demo label contains demo on idle frames", () => {
    const sim = createColony(parseAntColonyLook({}));
    const label = sim.packLabelText(frame({
      t: 0,
      dt: 0,
      audio: 0,
      demo: true,
      packets: [],
      talkers: [],
    }));
    expect(label.toLowerCase()).toContain("demo");
    sim.dispose();
  });

  it("keeps chamber layout keyed by host id when talkers reorder", () => {
    const sim = createColony(parseAntColonyLook({ seed: "77" }));
    const base = frame({
      t: 1,
      dt: 1 / 60,
      audio: 0,
      packets: [{ proto: "tcp", size: 100, field: 0.4 }],
      sys: EMPTY_SYS,
      talkers: [
        { id: "host-alpha", rate: 200, role: "gateway" },
        { id: "host-beta", rate: 40, role: "lan" },
      ],
    });
    sim.tick(base);
    const before = new Map(sim.chamberSnapshot().map((c) => [c.id, c]));
    sim.tick(frame({
      ...base,
      t: 2,
      talkers: [
        { id: "host-beta", rate: 40, role: "lan" },
        { id: "host-alpha", rate: 200, role: "gateway" },
      ],
    }));
    const after = new Map(sim.chamberSnapshot().map((c) => [c.id, c]));
    expect(after.get("host-alpha")?.x).toBeCloseTo(before.get("host-alpha")!.x, 5);
    expect(after.get("host-alpha")?.y).toBeCloseTo(before.get("host-alpha")!.y, 5);
    expect(after.get("host-beta")?.x).toBeCloseTo(before.get("host-beta")!.x, 5);
    expect(after.get("host-beta")?.heat).toBeLessThan(after.get("host-alpha")!.heat);
    const label = sim.packLabelText(frame({
      ...base,
      talkers: [
        { id: "host-beta", rate: 40, role: "lan" },
        { id: "host-alpha", rate: 200, role: "gateway" },
      ],
    }));
    expect(label).toContain("200");
    expect(label.toLowerCase()).toContain("schematic");
    sim.dispose();
  });

  it("shows colony-wide fail visuals without pinning a chamber", () => {
    const sim = createColony(parseAntColonyLook({ seed: "88", mapFailures: "true" }));
    const sys = { ...EMPTY_SYS, failed: 0.6 };
    const mk = (order: "ab" | "ba") => frame({
      t: 3,
      dt: 1 / 60,
      audio: 0,
      packets: [{ proto: "tcp", size: 64, field: 0.2 }],
      sys,
      talkers: order === "ab"
        ? [{ id: "host-a", rate: 50, role: "gateway" }, { id: "host-b", rate: 180, role: "lan" }]
        : [{ id: "host-b", rate: 180, role: "lan" }, { id: "host-a", rate: 50, role: "gateway" }],
    });
    sim.tick(mk("ab"));
    const soldiersA = sim.soldierPositions();
    expect(sim.colonyWideFailLevel()).toBeGreaterThan(0.02);
    expect(sim.packLabelText(mk("ab")).toLowerCase()).toContain("colony fail");
    const chambers = sim.chamberSnapshot();
    const packed = sim.packSlots(mk("ab"))[1]!;
    for (let i = 0; i < chambers.length; i++) {
      expect(packed[i * 4 + 3]!).toBeCloseTo(chambers[i]!.heat, 4);
    }
    sim.tick(mk("ba"));
    expect(sim.packLabelText(mk("ba")).toLowerCase()).toContain("colony fail");
    expect(soldiersA.length).toBeGreaterThan(2);
    for (const pos of soldiersA) {
      expect(pos.y).toBeLessThan(NEST_ENTRANCE.y + 0.05);
    }
    const atChamber = soldiersA.filter((p) =>
      chambers.some((c) => Math.hypot(p.x - c.x, p.y - c.y) < 0.02),
    );
    expect(atChamber.length).toBeLessThan(soldiersA.length / 2);
    sim.dispose();
  });

  it("does not recycle a departed host chamber for a new host", () => {
    const sim = createColony(parseAntColonyLook({ seed: "99" }));
    const base = frame({
      t: 0,
      dt: 1 / 60,
      audio: 0,
      packets: [],
      sys: EMPTY_SYS,
      talkers: [
        { id: "leaving-host", rate: 120, role: "lan" },
        { id: "staying-host", rate: 80, role: "lan" },
      ],
    });
    sim.tick(base);
    const leaving = sim.chamberSnapshot().find((c) => c.id === "leaving-host")!;
    sim.tick(frame({
      ...base,
      t: 1,
      talkers: [
        { id: "staying-host", rate: 80, role: "lan" },
        { id: "arriving-host", rate: 90, role: "lan" },
      ],
    }));
    const snap = sim.chamberSnapshot();
    expect(snap.some((c) => c.id === "leaving-host")).toBe(false);
    const arriving = snap.find((c) => c.id === "arriving-host")!;
    expect(arriving.x).not.toBeCloseTo(leaving.x, 3);
    expect(arriving.y).not.toBeCloseTo(leaving.y, 3);
    sim.dispose();
  });
});
