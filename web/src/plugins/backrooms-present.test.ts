import { describe, expect, it } from "vitest";
import FRONT from "../../../plugins/src/backrooms/frontend/index.ts?raw";
import { BR_SLOT, backroomsSlots } from "../../../plugins/src/backrooms/frontend/director";

describe("backrooms presentTick", () => {
  it("reads pluginClock from VizPresentTick (not legacy skyT args)", () => {
    expect(FRONT).toMatch(/onPresent\s*=\s*\(tick\)/);
    expect(FRONT).toMatch(/tick\.pluginClock/);
    expect(FRONT).not.toMatch(/skyT/);
  });

  it("advances simulation from pluginClock", () => {
    const clock = new Date(2026, 8, 26, 12, 0, 0);
    const early = backroomsSlots(2, clock, 16 / 9).slot0;
    const late = backroomsSlots(40, clock, 16 / 9).slot0;
    expect(late[BR_SLOT.mark]).toBe(early[BR_SLOT.mark]);
    expect(late.some((v, i) => v !== early[i])).toBe(true);
  });
});
