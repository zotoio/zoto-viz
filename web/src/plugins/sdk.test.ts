import { describe, expect, it } from "vitest";
import { PLUGIN_SDK } from "./sdk";

describe("PLUGIN_SDK", () => {
  it("exposes the host API and never fetch", () => {
    expect(PLUGIN_SDK).toContain("setStyle");
    expect(PLUGIN_SDK).toContain("onTick");
    expect(PLUGIN_SDK).toContain("onFrame");
    expect(PLUGIN_SDK).toContain("writeBuffer");
    expect(PLUGIN_SDK).not.toContain("fetch(");
  });
});
