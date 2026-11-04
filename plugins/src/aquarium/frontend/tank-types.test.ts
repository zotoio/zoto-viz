import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AquariumSim, parseAquariumOptions } from "./aquarium";
import { fishTemplate, FRESH_TRAITS, REEF_TRAITS } from "./fish-behaviour";
import { aggressionPairs, SALTWATER_SPECIES, FRESHWATER_SPECIES, TANKS, validateTank } from "./tank-types";

const GLB = resolve(__dirname, "../assets/aquarium-scape.glb");
function glbNodeNames(): string[] {
  const b = readFileSync(GLB);
  const n = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + n).toString("utf8")) as { nodes: { name?: string }[] };
  return j.nodes.map((x) => x.name ?? "");
}

describe("tank types never mix fresh and salt water", () => {
  it("the validator rejects cross-mixing", () => {
    expect(validateTank("freshwater", ["neon", "betta"])).toEqual([]);
    expect(validateTank("freshwater", ["neon", "clown"])).toHaveLength(1);
    expect(validateTank("reef", ["clown", "angel"])).toHaveLength(1);
    expect(validateTank("reef", [], ["reef-anemone", "fresh-driftwood"])).toHaveLength(1);
    expect(validateTank("freshwater", [], ["fresh-plant-vallisneria", "reef-coral-fan"])).toHaveLength(1);
    expect(validateTank("reef", [], [], [["damsel", "neon"]])).toHaveLength(1);
  });

  it("species lists are disjoint and match the sim and trait tables", () => {
    for (const s of FRESHWATER_SPECIES) expect(SALTWATER_SPECIES as readonly string[]).not.toContain(s);
    expect(FRESH_TRAITS.map((_, i) => fishTemplate(i, false))).toEqual([...TANKS.freshwater.species]);
    expect(REEF_TRAITS.map((_, i) => fishTemplate(i, true))).toEqual([...TANKS.reef.species]);
  });

  it("aggression pairs stay inside each tank", () => {
    for (const t of ["freshwater", "reef"] as const) {
      const pairs = aggressionPairs(t);
      expect(validateTank(t, [], [], pairs)).toEqual([]);
    }
  });

  it("data-driven spawns only ever pick the tank's own species", () => {
    for (const tankType of ["freshwater", "reef"] as const) {
      const sim = new AquariumSim(parseAquariumOptions({ tankType, fishCount: "16" }));
      const talkers = Array.from({ length: 24 }, (_, i) => ({ id: `h${i * 31}`, rate: 10 + i * 13, role: ["lan", "internet", "gateway", "device"][i % 4]! }));
      for (let i = 0; i < 90; i++) sim.advance({ t: i / 60, dt: 1 / 60, audio: 0, talkers, packets: [], demo: false });
      const names = [...sim.fishSpeciesById().values()].map((s) => fishTemplate(s, tankType === "reef"));
      expect(names.length).toBeGreaterThan(0);
      expect(validateTank(tankType, names)).toEqual([]);
    }
  });

  it("switching tank type rebuilds the school (no fish carries over)", () => {
    const sim = new AquariumSim(parseAquariumOptions({ tankType: "freshwater", fishCount: "8" }));
    const talkers = [{ id: "a", rate: 20, role: "lan" }];
    for (let i = 0; i < 30; i++) sim.advance({ t: i / 60, dt: 1 / 60, audio: 0, talkers, packets: [], demo: false });
    expect(sim.fishBodiesCount()).toBeGreaterThan(0);
    sim.setOptions(parseAquariumOptions({ tankType: "reef", fishCount: "8" }));
    expect(sim.fishBodiesCount()).toBe(0);
    expect(parseAquariumOptions({ tankType: "reef" }).water).toBe("reef");
    expect(parseAquariumOptions({ tankType: "freshwater", water: "reef" }).water).toBe("fresh");
  });

  it("the shipped scape keeps fresh and reef decor in their own groups", () => {
    const names = glbNodeNames();
    const decor = names.filter((n) => /^(fresh|reef)-/.test(n));
    expect(validateTank("freshwater", [], decor.filter((n) => n.startsWith("fresh-")))).toEqual([]);
    expect(validateTank("reef", [], decor.filter((n) => n.startsWith("reef-")))).toEqual([]);
    for (const s of [...FRESHWATER_SPECIES, ...SALTWATER_SPECIES]) expect(names).toContain(`fish-${s}`);
  });
});
