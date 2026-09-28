import { describe, expect, it } from "vitest";
import {
  LAYOUT_BODY_MAIN, LAYOUT_BODY_SATELLITE, layoutBodyBudget, selectLayoutBodyIds, usesFullDeviceTable,
} from "./layout-budget";
import { memory, topology } from "../core/modes";

describe("layout body budget", () => {
  it("caps a 1500-node offline snapshot under the main and satellite ceilings", () => {
    const nodes = [
      { id: "gw", role: "gateway", bytes: 10, rate: 1 },
      { id: "me", role: "self", bytes: 10, rate: 1 },
    ];
    for (let i = 0; i < 1500; i++) {
      nodes.push({ id: `inet-${i}`, role: "internet", bytes: i, rate: 0 });
    }
    const links = [
      { a: "gw", b: "me" },
      { a: "gw", b: "inet-1499" },
    ];
    const main = selectLayoutBodyIds(nodes, links, LAYOUT_BODY_MAIN);
    const sat = selectLayoutBodyIds(nodes, links, LAYOUT_BODY_SATELLITE);
    expect(main.size).toBeLessThanOrEqual(LAYOUT_BODY_MAIN);
    expect(sat.size).toBeLessThanOrEqual(LAYOUT_BODY_SATELLITE);
    expect(main.has("gw")).toBe(true);
    expect(main.has("me")).toBe(true);
    expect(main.has("inet-1499")).toBe(true);
    expect(sat.has("gw")).toBe(true);
    expect(layoutBodyBudget(false)).toBe(LAYOUT_BODY_MAIN);
    expect(layoutBodyBudget(true)).toBe(LAYOUT_BODY_SATELLITE);
  });

  it("leaves a small graph whole and skips sliced views", () => {
    const nodes = [{ id: "a", role: "lan", bytes: 1, rate: 0 }, { id: "b", role: "lan", bytes: 2, rate: 0 }];
    expect(selectLayoutBodyIds(nodes, [], LAYOUT_BODY_SATELLITE).size).toBe(2);
    expect(usesFullDeviceTable(topology)).toBe(true);
    expect(usesFullDeviceTable(memory)).toBe(false);
    expect(usesFullDeviceTable({ ...topology, stageOnly: true })).toBe(false);
    expect(usesFullDeviceTable({ ...topology, graphBase: "cpu" })).toBe(false);
    expect(usesFullDeviceTable({ ...topology, graphBase: "watch" })).toBe(true);
  });
});
