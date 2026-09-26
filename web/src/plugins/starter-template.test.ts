import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assignTalkerSlots, slottedTalkerIds } from "../../../plugins/sdk/talker-slots";
import { parseStarterOptions, DEFAULT_OPTIONS } from "../../../plugins/sdk/starter/frontend/config";
import { STARTER_DEMO_FRAME } from "../../../plugins/sdk/starter/frontend/demo-data";
import {
  missingLegendEntries,
  parseDeclaredMappingFields,
  USED_MAPPING_FIELDS,
} from "../../../plugins/sdk/starter/frontend/mapping";
import { StarterSim, cornerLabel } from "../../../plugins/sdk/starter/frontend/sim";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const starterRoot = path.join(repoRoot, "plugins/sdk/starter");
const mappingYaml = readFileSync(path.join(starterRoot, "data-mapping.yml"), "utf8");

describe("pack starter template", () => {
  it("data-mapping covers every used field", () => {
    const declared = parseDeclaredMappingFields(mappingYaml);
    expect(missingLegendEntries(declared, USED_MAPPING_FIELDS)).toEqual([]);
  });

  it("talker slots stay stable across reorder", () => {
    let slots = assignTalkerSlots(
      [{ id: "a", rate: 100 }, { id: "b", rate: 90 }],
      [null, null],
      2,
      0,
    );
    slots = assignTalkerSlots(
      [{ id: "b", rate: 200 }, { id: "a", rate: 50 }],
      slots,
      2,
      1,
    );
    expect(slottedTalkerIds(slots).sort()).toEqual(["a", "b"]);
  });

  it("corner label uses displayName from config", () => {
    const o = parseStarterOptions({ displayName: "Koi" });
    expect(cornerLabel(o.displayName, "idle", false)).toBe("Koi · idle");
    expect(cornerLabel(o.displayName, "fail", true)).toBe("Koi · fail · demo");
    expect(parseStarterOptions({})).toEqual(DEFAULT_OPTIONS);
  });

  it("four talker bars and murk use separate slot0 indices", () => {
    const sim = new StarterSim({ displayName: "Starter" });
    const frame = {
      ...STARTER_DEMO_FRAME,
      talkers: [
        { id: "t0", rate: 200, role: "lan" },
        { id: "t1", rate: 160, role: "lan" },
        { id: "t2", rate: 120, role: "lan" },
        { id: "t3", rate: 80, role: "lan" },
      ],
      sys: { ...STARTER_DEMO_FRAME.sys!, failed: 0.5 },
    };
    for (let i = 0; i < 90; i++) {
      sim.advance({ ...frame, t: i / 60, dt: 1 / 60 }, 1280, 800);
    }
    const packed = sim.advance(frame, 1280, 800);
    expect(packed.slot0[3]).toBeCloseTo(80 / 200, 5);
    expect(packed.slot0[8]).toBe(0.5);
  });

  it("teardown counts slots and motion listener", () => {
    const sim = new StarterSim({ displayName: "Starter" });
    sim.warm(STARTER_DEMO_FRAME, 1280, 800);
    const counts = sim.teardown();
    expect(counts.slotsCleared).toBeGreaterThan(0);
    expect(counts.listenersRemoved).toBe(1);
  });

  it("no new slot-array growth after warm-up", () => {
    const sim = new StarterSim({ displayName: "Starter" });
    sim.warm(STARTER_DEMO_FRAME, 1280, 800);
    const before = sim.slotArrayReplacedSinceWarm();
    for (let i = 0; i < 120; i++) {
      sim.advance({ ...STARTER_DEMO_FRAME, t: i / 60, dt: 1 / 60 }, 1280, 800);
    }
    expect(sim.slotArrayReplacedSinceWarm()).toBe(before);
  });

  it("demo frame packs non-empty bars", () => {
    const sim = new StarterSim({ displayName: "Starter" });
    const packed = sim.advance(STARTER_DEMO_FRAME, 1280, 800);
    const sum = packed.slot0[0] + packed.slot0[1] + packed.slot0[2];
    expect(sum).toBeGreaterThan(0);
    expect(packed.smokeLuma).toBeGreaterThan(0);
  });
});
