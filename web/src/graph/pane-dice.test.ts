import { describe, expect, it } from "vitest";
import { pickPaneDiceView } from "./pane-dice";

const full = new Set(["topology", "watch"]);
const isFull = (id: string) => full.has(id);

describe("pickPaneDiceView", () => {
  it("picks a different view than the pane already shows", () => {
    const seen = new Set<string>();
    for (let n = 0; n < 20; n++) {
      const pick = pickPaneDiceView("topology", ["topology", "memory"], ["topology", "memory", "cpu"], isFull, Math.random);
      expect(pick).not.toBe("topology");
      if (pick) seen.add(pick);
    }
    expect(seen.has("memory") || seen.has("cpu")).toBe(true);
  });

  it("does not add a second full-device graph", () => {
    const pick = pickPaneDiceView(
      "cpu",
      ["topology", "cpu"],
      ["watch", "memory", "cpu"],
      isFull,
      () => 0,
    );
    expect(pick).toBe("memory");
  });

  it("prefers a view that is not already on the wall", () => {
    const pick = pickPaneDiceView(
      "cpu",
      ["topology", "cpu", "memory"],
      ["memory", "bluetooth", "cpu"],
      isFull,
      () => 0,
    );
    expect(pick).toBe("bluetooth");
  });

  it("returns null when every candidate is the current view", () => {
    expect(pickPaneDiceView("cpu", ["cpu"], ["cpu"], isFull, () => 0)).toBeNull();
  });
});
