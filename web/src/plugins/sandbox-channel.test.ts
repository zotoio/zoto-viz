import { describe, expect, it } from "vitest";
import { HOST_SOURCE, isHostBootChannel, isPluginPortMsg } from "./sandbox-channel";

describe("sandbox-channel", () => {
  it("recognizes boot-channel handoff", () => {
    expect(isHostBootChannel({
      source: HOST_SOURCE,
      type: "boot-channel",
      bootNonce: "n",
      parentOrigin: "http://127.0.0.1:7020",
    })).toBe(true);
    expect(isHostBootChannel({ source: HOST_SOURCE, type: "boot", bootNonce: "n" })).toBe(false);
  });

  it("recognizes plugin port payloads", () => {
    expect(isPluginPortMsg({ source: "zoto-viz-plugin", type: "tick", nodes: [] })).toBe(true);
    expect(isPluginPortMsg({ source: "zoto-viz-plugin", type: "ready", bootNonce: "n" })).toBe(true);
  });
});
