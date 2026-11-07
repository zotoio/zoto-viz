import { describe, expect, it } from "vitest";
import { newFollowEngage, stepFollowEngage } from "./follow-engage";

describe("koi follow engage (sometimes-on)", () => {
  it("stays off until nextStart then engages for a bout", () => {
    const st = newFollowEngage(0.5);
    st.nextStart = 5;
    const rand = () => 0.5;
    expect(stepFollowEngage(st, 1, rand)).toBe(false);
    expect(stepFollowEngage(st, 5, rand)).toBe(true);
    expect(st.engaged).toBe(true);
    expect(st.boutEnd).toBeGreaterThan(5);
    expect(stepFollowEngage(st, st.boutEnd + 0.01, rand)).toBe(false);
    expect(st.engaged).toBe(false);
  });
});
