import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/ant-colony/sky/fragment.glsl?raw";
import VIS from "../../../plugins/src/ant-colony/visualisation.yml?raw";
import PLUGIN from "../../../plugins/src/ant-colony/plugin.yml?raw";
import {
  ANT_DATA_MAPPING,
  ANT_WORK_BUDGET,
  cycleColonyTeardown,
  parseAntColonyLook,
  AntColonySim,
  PG_CELLS,
  createColony,
} from "../../../plugins/src/ant-colony/frontend/index";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";

const TRADEMARKS = ["Minecraft", "Mojang", "Rocket League", "Psyonix"];

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
        sim.tick({
          t: i / 30,
          dt: 1 / 60,
          audio: 0.2,
          packets: [{ proto: "udp", size: 200, field: 0.5 }],
          talkers: [{ id: "hub", rate: 120, role: "gateway" }],
          sys: { failed: preset === "red-alert" ? 0.4 : 0 },
        });
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
    const frame = {
      t: 2,
      dt: 1 / 60,
      audio: 0,
      packets: [{ proto: "tcp", size: 80, field: 0.3 }],
      talkers: [{ id: "x", rate: 90, role: "lan" }, { id: "y", rate: 40, role: "lan" }],
    };
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
    const label = sim.packLabelText({
      t: 0,
      dt: 0,
      audio: 0,
      demo: true,
      packets: [],
      talkers: [],
    });
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
    const base = {
      t: 1,
      dt: 1 / 60,
      audio: 0,
      packets: [{ proto: "tcp", size: 100, field: 0.4 }],
      sys: { failed: 0 },
    };
    sim.tick({
      ...base,
      talkers: [
        { id: "host-alpha", rate: 200, role: "gateway" },
        { id: "host-beta", rate: 40, role: "lan" },
      ],
    });
    const before = new Map(sim.chamberSnapshot().map((c) => [c.id, c]));
    sim.tick({
      ...base,
      t: 2,
      talkers: [
        { id: "host-beta", rate: 40, role: "lan" },
        { id: "host-alpha", rate: 200, role: "gateway" },
      ],
    });
    const after = new Map(sim.chamberSnapshot().map((c) => [c.id, c]));
    expect(after.get("host-alpha")?.x).toBeCloseTo(before.get("host-alpha")!.x, 5);
    expect(after.get("host-alpha")?.y).toBeCloseTo(before.get("host-alpha")!.y, 5);
    expect(after.get("host-beta")?.heat).toBeLessThan(after.get("host-alpha")!.heat);
    const label = sim.packLabelText({ ...base, talkers: [{ id: "host-beta", rate: 40, role: "lan" }, { id: "host-alpha", rate: 200, role: "gateway" }] });
    expect(label).toContain("200");
    sim.dispose();
  });

  it("moves the fail swarm with the failing host id, not list slot", () => {
    const sim = createColony(parseAntColonyLook({ seed: "88", mapFailures: "true" }));
    const frame = (order: "ab" | "ba") => ({
      t: 3,
      dt: 1 / 60,
      audio: 0,
      packets: [],
      sys: { failed: 0.6 },
      talkers: order === "ab"
        ? [{ id: "fail-host", rate: 50, role: "gateway" }, { id: "other-host", rate: 180, role: "lan" }]
        : [{ id: "other-host", rate: 180, role: "lan" }, { id: "fail-host", rate: 50, role: "gateway" }],
    });
    sim.tick(frame("ab"));
    const posA = sim.soldierMarkerPosition();
    expect(sim.failureAnchorHostId()).toBe("fail-host");
    sim.tick(frame("ba"));
    const posB = sim.soldierMarkerPosition();
    expect(sim.failureAnchorHostId()).toBe("fail-host");
    expect(posA?.x).toBeCloseTo(posB!.x, 5);
    expect(posA?.y).toBeCloseTo(posB!.y, 5);
    const failCh = sim.chamberSnapshot().find((c) => c.id === "fail-host");
    expect(failCh?.fail).toBeGreaterThan(0);
    const other = sim.chamberSnapshot().find((c) => c.id === "other-host");
    expect(other?.fail ?? 0).toBe(0);
    sim.dispose();
  });

  it("does not recycle a departed host chamber for a new host", () => {
    const sim = createColony(parseAntColonyLook({ seed: "99" }));
    const base = { t: 0, dt: 1 / 60, audio: 0, packets: [], sys: { failed: 0 } };
    sim.tick({
      ...base,
      talkers: [
        { id: "leaving-host", rate: 120, role: "lan" },
        { id: "staying-host", rate: 80, role: "lan" },
      ],
    });
    const leaving = sim.chamberSnapshot().find((c) => c.id === "leaving-host")!;
    sim.tick({
      ...base,
      t: 1,
      talkers: [
        { id: "staying-host", rate: 80, role: "lan" },
        { id: "arriving-host", rate: 90, role: "lan" },
      ],
    });
    const snap = sim.chamberSnapshot();
    expect(snap.some((c) => c.id === "leaving-host")).toBe(false);
    const arriving = snap.find((c) => c.id === "arriving-host")!;
    expect(arriving.x).not.toBeCloseTo(leaving.x, 3);
    expect(arriving.y).not.toBeCloseTo(leaving.y, 3);
    sim.dispose();
  });
});
