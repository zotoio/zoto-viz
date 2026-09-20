import { describe, expect, it } from "vitest";
import { backroomsRoarLevel, roarAmp, PluginSfx } from "./plugin-sfx";

describe("plugin sfx roar", () => {
  it("keeps the roar quiet and squares the attack", () => {
    expect(roarAmp(0)).toBe(0);
    expect(roarAmp(1)).toBeCloseTo(0.38, 5);
    expect(roarAmp(0.5)).toBeCloseTo(0.095, 5);
    expect(roarAmp(2)).toBe(roarAmp(1));
    expect(roarAmp(-1)).toBe(0);
  });

  it("rises when the Backrooms creature is close", () => {
    let peak = 0;
    for (let i = 0; i < 400; i++) peak = Math.max(peak, backroomsRoarLevel(i * 0.05));
    expect(peak).toBeGreaterThan(0.4);
    expect(backroomsRoarLevel(0)).toBeGreaterThanOrEqual(0);
  });

  it("roars on the turn-and-run after a corridor spot", () => {
    const fleeT = 0.50 / 0.040;
    expect(backroomsRoarLevel(fleeT)).toBeGreaterThan(0.7);
    const stareT = 0.07 / 0.040;
    expect(backroomsRoarLevel(stareT)).toBeLessThan(0.2);
  });

  it("accepts levels without throwing when Web Audio is missing", () => {
    const sfx = new PluginSfx();
    sfx.setRoar(0.8);
    sfx.setRoar(0);
    sfx.silence();
    sfx.dispose();
  });
});
