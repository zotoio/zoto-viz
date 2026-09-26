import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  VIZ_FIXTURE_GOLDEN_LIVE_FAILED,
  VIZ_FIXTURE_IDLE,
} from "../../viz-fixtures";
import { scanPackLintFixture } from "../../pack-lint";
import { assignTalkerSlots, slottedTalkerIds } from "../../talker-slots";
import { parseStarterOptions, DEFAULT_OPTIONS } from "./config";
import { STARTER_DEMO_FRAME } from "./demo-data";
import { missingLegendEntries, parseDeclaredMappingFields, USED_MAPPING_FIELDS } from "./mapping";
import { StarterSim, cornerLabel } from "./sim";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const starterRoot = path.join(repoRoot, "plugins/sdk/starter");
const mappingYaml = readFileSync(path.join(starterRoot, "data-mapping.yml"), "utf8");

describe("pack starter template", () => {
  it("data-mapping covers every used field", () => {
    const declared = parseDeclaredMappingFields(mappingYaml);
    expect(missingLegendEntries(declared, USED_MAPPING_FIELDS)).toEqual([]);
  });

  it("lint-clean when treated as a shipped pack path", () => {
    const fe = readFileSync(path.join(starterRoot, "frontend/index.ts"), "utf8");
    const sim = readFileSync(path.join(starterRoot, "frontend/sim.ts"), "utf8");
    for (const [name, text] of [["index.ts", fe], ["sim.ts", sim]] as const) {
      const hits = scanPackLintFixture(
        `plugins/src/starter-copy/frontend/${name}`,
        text,
        "starter-copy",
        repoRoot,
      );
      expect(hits).toEqual([]);
    }
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
    expect(parseStarterOptions({})).toEqual(DEFAULT_OPTIONS);
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

  it("idle vs idle-failed produce different failure visuals", () => {
    const idleSim = new StarterSim({ displayName: "Starter" });
    const failSim = new StarterSim({ displayName: "Starter" });
    const idle = idleSim.advance(VIZ_FIXTURE_IDLE, 1280, 800);
    const failed = failSim.advance(VIZ_FIXTURE_GOLDEN_LIVE_FAILED, 1280, 800);
    expect(idle.smokeLuma).not.toBe(failed.smokeLuma);
    expect(idle.slot0[3]).toBeLessThan(failed.slot0[3]);
  });

  it("demo frame packs non-empty bars", () => {
    const sim = new StarterSim({ displayName: "Starter" });
    const packed = sim.advance(STARTER_DEMO_FRAME, 1280, 800);
    const sum = packed.slot0[0] + packed.slot0[1] + packed.slot0[2];
    expect(sum).toBeGreaterThan(0);
    expect(packed.smokeLuma).toBeGreaterThan(0);
  });
});
