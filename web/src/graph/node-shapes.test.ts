import { describe, expect, it } from "vitest";
import { nodeShapeIndex } from "./node-shapes";

describe("node shapes", () => {
  it("gives a device type its own form when the view does not pin one", () => {
    expect(nodeShapeIndex("auto", undefined, "phone", "a")).not.toBe(nodeShapeIndex("auto", undefined, "speaker", "a"));
    expect(nodeShapeIndex("auto", undefined, "gateway", "gw")).toBe(3);
  });

  it("keeps a view-supplied shape under auto and lets a pin replace it", () => {
    expect(nodeShapeIndex("auto", 6, "phone", "drone")).toBe(6);
    expect(nodeShapeIndex("ring", 6, "phone", "drone")).toBe(7);
    expect(nodeShapeIndex("sphere", undefined, "iot", "x")).toBe(0);
  });

  it("mixes neighbouring nodes onto different forms", () => {
    const a = nodeShapeIndex("mixed", 0, "lan", "10.0.0.1");
    const b = nodeShapeIndex("mixed", 0, "lan", "gateway");
    expect(a).not.toBe(b);
    expect(nodeShapeIndex("mixed", 0, "lan", "10.0.0.1")).toBe(a);
  });
});
