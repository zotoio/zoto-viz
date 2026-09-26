import { describe, expect, it } from "vitest";
import {
  assignTalkerSlots,
  slottedTalkerIds,
  TALKER_SLOT_CHALLENGER_MARGIN,
  TALKER_SLOT_HOLD_S,
} from "./talker-slots";

const t = (id: string, rate: number) => ({ id, rate });

describe("assignTalkerSlots", () => {
  it("fills empty slots immediately with top unassigned talkers", () => {
    const slots = assignTalkerSlots(
      [t("a", 100), t("b", 80)],
      [null, null],
      2,
      0,
    );
    expect(slottedTalkerIds(slots)).toEqual(["a", "b"]);
  });

  it("releases a slot when its talker leaves the host list", () => {
    let slots = assignTalkerSlots([t("a", 100)], [null], 1, 0);
    expect(slottedTalkerIds(slots)).toEqual(["a"]);
    slots = assignTalkerSlots([], slots, 1, 1);
    expect(slottedTalkerIds(slots)).toEqual([]);
  });

  it("holds incumbent for 2s before a marginal challenger can replace", () => {
    let slots = assignTalkerSlots([t("a", 100)], [null], 1, 0);
    slots = assignTalkerSlots([t("a", 50), t("b", 110)], slots, 1, 0.5);
    expect(slottedTalkerIds(slots)).toEqual(["a"]);
    slots = assignTalkerSlots([t("a", 50), t("b", 200)], slots, 1, TALKER_SLOT_HOLD_S);
    expect(slottedTalkerIds(slots)).toEqual(["b"]);
  });

  it("requires challenger margin after hold", () => {
    let slots = assignTalkerSlots([t("a", 100)], [null], 1, 0);
    const marginal = 100 * TALKER_SLOT_CHALLENGER_MARGIN - 1;
    slots = assignTalkerSlots([t("a", 100), t("b", marginal)], slots, 1, TALKER_SLOT_HOLD_S);
    expect(slottedTalkerIds(slots)).toEqual(["a"]);
  });

  it("keeps slot stable when talkers reorder but ids unchanged", () => {
    let slots = assignTalkerSlots([t("a", 100), t("b", 90)], [null, null], 2, 0);
    slots = assignTalkerSlots([t("b", 200), t("a", 50)], slots, 2, 1);
    expect(slottedTalkerIds(slots).sort()).toEqual(["a", "b"]);
  });

  it("allows concurrent A and B in separate slots", () => {
    const slots = assignTalkerSlots(
      [t("a", 100), t("b", 99)],
      [null, null],
      2,
      0,
    );
    expect(slottedTalkerIds(slots).sort()).toEqual(["a", "b"]);
  });
});
