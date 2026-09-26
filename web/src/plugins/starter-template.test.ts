import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assignTalkerSlots,
  createTalkerSlotArrays,
  createTalkerSlotScratch,
  slottedTalkerIds,
} from "../../../plugins/sdk/talker-slots";
import { parseStarterOptions, DEFAULT_OPTIONS } from "../../../plugins/sdk/starter/frontend/config";
import { STARTER_DEMO_FRAME } from "../../../plugins/sdk/starter/frontend/demo-data";
import {
  missingLegendEntries,
  parseDeclaredMappingFields,
  USED_MAPPING_FIELDS,
} from "../../../plugins/sdk/starter/frontend/mapping";
import { StarterSim, cornerLabel } from "../../../plugins/sdk/starter/frontend/sim";
import {
  scanStarterPackCatalog,
  stageStarterTree,
  STARTER_CI_PACK_ID,
} from "./starter-pack-pipeline";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const starterRoot = path.join(repoRoot, "plugins/sdk/starter");
const mappingYaml = readFileSync(path.join(starterRoot, "data-mapping.yml"), "utf8");

describe("pack starter template", () => {
  it("data-mapping covers every used field", () => {
    const declared = parseDeclaredMappingFields(mappingYaml);
    expect(missingLegendEntries(declared, USED_MAPPING_FIELDS)).toEqual([]);
  });

  it("talker slots stay stable across reorder", () => {
    const scratch = createTalkerSlotScratch();
    let [read, write] = createTalkerSlotArrays(2);
    const m0 = new Map([["a", { rate: 100 }], ["b", { rate: 90 }]]);
    assignTalkerSlots(m0, read, write, scratch, 0);
    [read, write] = [write, read];
    const m1 = new Map([["b", { rate: 200 }], ["a", { rate: 50 }]]);
    assignTalkerSlots(m1, read, write, scratch, 1);
    expect(slottedTalkerIds(write).sort()).toEqual(["a", "b"]);
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

  it("talkerSlotsArray snapshot is unchanged across later sim steps", () => {
    const sim = new StarterSim({ displayName: "Starter" });
    for (let i = 0; i < 30; i++) {
      sim.advance({ ...STARTER_DEMO_FRAME, t: i / 60, dt: 1 / 60 }, 1280, 800);
    }
    const snapshot = sim.talkerSlotsArray();
    const frozen = snapshot.map((s) => ({ id: s.id, assignedAt: s.assignedAt }));
    sim.warm(STARTER_DEMO_FRAME, 1280, 800);
    for (let i = 0; i < 120; i++) {
      sim.advance({ ...STARTER_DEMO_FRAME, t: i / 60, dt: 1 / 60 }, 1280, 800);
    }
    expect(snapshot).toEqual(frozen);
    if (snapshot[0]) snapshot[0].id = "__mutated__";
    expect(sim.talkerSlotsArray()[0]?.id).not.toBe("__mutated__");
  });

  it("starter shader uses int vec subscripts only", () => {
    const glsl = readFileSync(path.join(starterRoot, "sky/fragment.glsl"), "utf8");
    expect(glsl).not.toMatch(/\[mod\s*\(\s*float/);
    expect(glsl).toMatch(/zotoVizSlots\[0\]\[i\]/);
  });

  it("starter frontend value-imports SDK runtime helpers (bundled at pack build)", () => {
    const indexSrc = readFileSync(path.join(starterRoot, "frontend/index.ts"), "utf8");
    const simSrc = readFileSync(path.join(starterRoot, "frontend/sim.ts"), "utf8");
    expect(indexSrc).toMatch(/VIZ_PACK_TILE_FALLBACK/);
    expect(simSrc).toMatch(/assignTalkerSlots/);
    expect(indexSrc).toMatch(/getVizZoto/);
  });

  it("staged starter passes plugins.scan without catalog errors", () => {
    const { stageRoot } = stageStarterTree(starterRoot, repoRoot);
    try {
      const scan = scanStarterPackCatalog(repoRoot, stageRoot, STARTER_CI_PACK_ID);
      expect(scan.errors).toEqual([]);
      expect(scan.pluginIds).toContain(STARTER_CI_PACK_ID);
    } finally {
      rmSync(stageRoot, { recursive: true, force: true });
    }
  },
  );

  it("pack entry applies saved config and drives uTime", () => {
    const indexSrc = readFileSync(path.join(starterRoot, "frontend/index.ts"), "utf8");
    expect(indexSrc).toContain("getConfig");
    expect(indexSrc).toContain("asStarterFrame");
    expect(indexSrc).toContain('writeUniform("uTime"');
    expect(indexSrc).not.toContain("encodeCornerLabel");
  });

  it("demo frame packs non-empty bars", () => {
    const sim = new StarterSim({ displayName: "Starter" });
    const packed = sim.advance(STARTER_DEMO_FRAME, 1280, 800);
    const sum = packed.slot0[0] + packed.slot0[1] + packed.slot0[2];
    expect(sum).toBeGreaterThan(0);
    expect(packed.smokeLuma).toBeGreaterThan(0);
  });
});
