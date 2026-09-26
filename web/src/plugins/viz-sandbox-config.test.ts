import { describe, expect, it } from "vitest";
import { shouldPushSandboxPluginConfig } from "./viz-sandbox-config";

describe("shouldPushSandboxPluginConfig", () => {
  it("blocks pushing view opts when the sandbox still holds another pack", () => {
    expect(shouldPushSandboxPluginConfig("backrooms", "lan-pulse")).toBe(false);
    expect(shouldPushSandboxPluginConfig("backrooms", "backrooms")).toBe(true);
    expect(shouldPushSandboxPluginConfig(undefined, "backrooms")).toBe(false);
  });
});
