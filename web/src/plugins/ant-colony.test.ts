import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/ant-colony/sky/fragment.glsl?raw";
import VIS from "../../../plugins/src/ant-colony/visualisation.yml?raw";
import PLUGIN from "../../../plugins/src/ant-colony/plugin.yml?raw";
import type { AntColonyFrame } from "../../../plugins/src/ant-colony/frontend/frame";
import type { VizDataFrame } from "../plugins/viz-host";
import {
  ANT_DATA_MAPPING,
  ANT_WORK_BUDGET,
  NEST_ENTRANCE,
  cycleColonyTeardown,
  parseAntColonyLook,
  AntColonySim,
  PG_CELLS,
  createColony,
} from "../../../plugins/src/ant-colony/frontend/index";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";

const TRADEMARKS = ["Minecraft", "Mojang", "Rocket League", "Psyonix"];

/** Minimal host-shaped frame for light tests (only real VizDataFrame fields). */
function hostFrame(slice: AntColonyFrame): VizDataFrame {
  return {
    rf: [],
    headlines: [],
    ...slice,
  };
}

describe("ant-colony pack", () => {
  it("validates presets and mapping metadata", () => {
    const look = parseAntColonyLook({ preset: "night-glow", antCap: "200", seed: "1" });
    expect(look.preset).toBe("night-glow");
    expect(look.antCap).toBe(160);
    expect(ANT_DATA_MAPPING.length).toBeGreaterThanOrEqual(4);
    expect(ANT_WORK_BUDGET.instances).toBeGreaterThanOrEqual(look.antCap);
  });

  it("keeps work counts under caps for every preset", () => {
    for (const preset of ["formicarium", "night-glow", "red-alert", "minimal"] as const) {
      const sim = createColony(parseAntColonyLook({ preset, seed: "42" }));
      for (let i = 0; i < 30; i++) {
        sim.tick(hostFrame({
          t: i / 30,
          dt: 1 / 60,
          audio: 0.2,
          packets: [{ proto: "udp", size: 200, field: 0.5 }],
          talkers: [{ id: "hub", rate: 120, role: "gateway" }],
          sys: { cpu: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, failed: preset === "red-alert" ? 0.4 : 0, udev: 0 },
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
    const frame = hostFrame({
      t: 2,
      dt: 1 / 60,
      audio: 0,
      packets: [{ proto: "tcp", size: 80, field: 0.3 }],
      talkers: [{ id: "x", rate: 90, role: "lan" }, { id: "y", rate: 40, role: "lan" }],
    });
    for (let i = 0; i < 20; i++) {
      a.tick(frame);
      b.tick(frame);
    }
    expect(a.packSlots(frame)[0]).toEqual(b.packSlots(frame)[0]);
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
    const label = sim.packLabelText(hostFrame({
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

  it("compiles the sky shader (smoke, non-black)", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
    expect(wrapped.frag).toContain("zotoVizSlots");
  });

  it("passes trademark name check on shipped text", () => {
    const blob = `${PLUGIN}\n${VIS}\n${FRAG}`;
    for (const mark of TRADEMARKS) {
      expect(blob.toLowerCase()).not.toContain(mark.toLowerCase());
    }
  });

  it("keeps chamber layout keyed by host id when talkers reorder", () => {
    const sim = createColony(parseAntColonyLook({ seed: "77" }));
    const base = hostFrame({
      t: 1,
      dt: 1 / 60,
      audio: 0,
      packets: [{ proto: "tcp", size: 100, field: 0.4 }],
      sys: { cpu: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, failed: 0, udev: 0 },
      talkers: [
        { id: "host-alpha", rate: 200, role: "gateway" },
        { id: "host-beta", rate: 40, role: "lan" },
      ],
    });
    sim.tick(base);
    const before = new Map(sim.chamberSnapshot().map((c) => [c.id, c]));
    sim.tick(hostFrame({
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
    const label = sim.packLabelText(hostFrame({
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
    const sys = { cpu: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, failed: 0.6, udev: 0 };
    const frame = (order: "ab" | "ba") => hostFrame({
      t: 3,
      dt: 1 / 60,
      audio: 0,
      packets: [{ proto: "tcp", size: 64, field: 0.2 }],
      sys,
      talkers: order === "ab"
        ? [{ id: "host-a", rate: 50, role: "gateway" }, { id: "host-b", rate: 180, role: "lan" }]
        : [{ id: "host-b", rate: 180, role: "lan" }, { id: "host-a", rate: 50, role: "gateway" }],
    });
    sim.tick(frame("ab"));
    const soldiersA = sim.soldierPositions();
    const labelA = sim.packLabelText(frame("ab"));
    expect(sim.colonyWideFailLevel()).toBeGreaterThan(0.02);
    expect(labelA.toLowerCase()).toContain("colony fail");
    const chambers = sim.chamberSnapshot();
    const packed = sim.packSlots(frame("ab"))[1]!;
    for (let i = 0; i < chambers.length; i++) {
      const heatSlot = packed[i * 4 + 3]!;
      expect(heatSlot).toBeCloseTo(chambers[i]!.heat, 4);
    }
    sim.tick(frame("ba"));
    const soldiersB = sim.soldierPositions();
    expect(sim.packLabelText(frame("ba")).toLowerCase()).toContain("colony fail");
    expect(soldiersA.length).toBeGreaterThan(2);
    expect(soldiersB.length).toBe(soldiersA.length);
    for (const pos of soldiersA) {
      expect(pos.y).toBeLessThan(NEST_ENTRANCE.y + 0.05);
    }
    const chamberCoords = chambers.map((c) => `${c.x},${c.y}`);
    const atChamber = soldiersA.filter((p) =>
      chamberCoords.some((_, i) =>
        Math.hypot(p.x - chambers[i]!.x, p.y - chambers[i]!.y) < 0.02,
      ),
    );
    expect(atChamber.length).toBeLessThan(soldiersA.length / 2);
    sim.dispose();
  });

  it("does not recycle a departed host chamber for a new host", () => {
    const sim = createColony(parseAntColonyLook({ seed: "99" }));
    const base = hostFrame({
      t: 0,
      dt: 1 / 60,
      audio: 0,
      packets: [],
      sys: { cpu: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, failed: 0, udev: 0 },
      talkers: [
        { id: "leaving-host", rate: 120, role: "lan" },
        { id: "staying-host", rate: 80, role: "lan" },
      ],
    });
    sim.tick(base);
    const leaving = sim.chamberSnapshot().find((c) => c.id === "leaving-host")!;
    sim.tick(hostFrame({
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
