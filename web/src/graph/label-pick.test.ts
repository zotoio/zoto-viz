import { describe, expect, it } from "vitest";
import { labelVisible, roleLabelIds, type LabelCandidate } from "./label-pick";

const node = (id: string, role: string, bytes = 0, rate = 0): LabelCandidate => ({ id, role, bytes, rate });
const base = { visible: true, focused: false, labelsOn: true, live: false, forced: false, byRole: false, suppressed: false };

describe("graph labels", () => {
  it("names a hovered or selected node even with labels off", () => {
    expect(labelVisible({ ...base, labelsOn: false, focused: true })).toBe(true);
    expect(labelVisible({ ...base, labelsOn: false, byRole: true, forced: true, live: true })).toBe(false);
    expect(labelVisible({ ...base, visible: false, focused: true })).toBe(false);
  });

  it("keeps the network rule on network graphs: host, gateway and the busiest LAN / internet nodes", () => {
    const keep = roleLabelIds([
      node("me", "self"),
      node("gw", "gateway"),
      node("tv", "lan", 900),
      node("nas", "lan", 50),
      node("cdn", "internet", 700),
      node("239.0.0.1", "multicast", 9999),
    ], 1);
    expect([...keep].sort()).toEqual(["cdn", "gw", "me", "tv"]);
  });

  it("labels the busiest nodes of a graph with no network roles, so turning labels on shows them", () => {
    const cores = Array.from({ length: 8 }, (_, i) => node(`cpu${i}`, "cpu", 0, i));
    const keep = roleLabelIds([node("zoto", "self"), ...cores], 3);
    expect([...keep].sort()).toEqual(["cpu5", "cpu6", "cpu7", "zoto"]);
  });

  it("still lets a view suppress a role-kept label, and force one", () => {
    expect(labelVisible({ ...base, byRole: true, suppressed: true })).toBe(false);
    expect(labelVisible({ ...base, forced: true, suppressed: true })).toBe(true);
  });
});
