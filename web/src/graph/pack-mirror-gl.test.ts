import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackMirrorRegistry } from "./pack-mirror-gl";

describe("PackMirrorRegistry", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allocates only when tile count crosses 2", () => {
    const reg = new PackMirrorRegistry();
    const scopes = new Map<string, { tileCount: number; antialias: boolean }>();
    for (let i = 0; i < 60; i++) {
      scopes.set("plugin:demo", { tileCount: 2, antialias: false });
      reg.syncScopes(scopes);
    }
    expect(reg.allocationCount).toBe(1);
    reg.syncScopes(new Map([["plugin:demo", { tileCount: 1, antialias: false }]]));
    expect(reg.sessionFor("plugin:demo")).toBeUndefined();
    reg.dispose();
  });

  it("keeps separate targets per pack key", () => {
    const reg = new PackMirrorRegistry();
    reg.syncScopes(new Map([
      ["plugin:a", { tileCount: 2, antialias: false }],
      ["plugin:b", { tileCount: 2, antialias: false }],
    ]));
    expect(reg.sessionFor("plugin:a")).toBeDefined();
    expect(reg.sessionFor("plugin:b")).toBeDefined();
    expect(reg.sessionFor("plugin:a")).not.toBe(reg.sessionFor("plugin:b"));
    expect(reg.allocationCount).toBe(2);
    reg.dispose();
  });
});
