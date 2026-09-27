import { describe, expect, it } from "vitest";
import {
  allowOnPluginChangeConfigPush,
  allowOnPluginFieldsConfigPush,
  sandboxConfigPushAllowed,
} from "./plugin-config-sync";

describe("sandboxConfigPushAllowed", () => {
  it("blocks cross-post when editing another pack tile store id", () => {
    expect.hasAssertions();
    expect(sandboxConfigPushAllowed("pack-a", "pack-b")).toBe(false);
    expect(sandboxConfigPushAllowed("pack-a:tile-1", "pack-a")).toBe(false);
    expect(sandboxConfigPushAllowed("pack-a", "pack-a")).toBe(true);
    expect(sandboxConfigPushAllowed(null, "pack-a")).toBe(false);
  });
});

describe("allowOnPluginChangeConfigPush", () => {
  it("requires config.read before allowing a push", () => {
    expect.hasAssertions();
    expect(allowOnPluginChangeConfigPush("pack-a", "pack-a", false)).toBe(false);
    expect(allowOnPluginChangeConfigPush("pack-a", "pack-a", true)).toBe(true);
  });
});

describe("allowOnPluginFieldsConfigPush", () => {
  it("requires config.read before allowing a push", () => {
    expect.hasAssertions();
    expect(allowOnPluginFieldsConfigPush("pack-a", "pack-a", false)).toBe(false);
    expect(allowOnPluginFieldsConfigPush("pack-a", "pack-a", true)).toBe(true);
  });
});
