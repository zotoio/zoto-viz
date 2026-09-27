import { describe, expect, it } from "vitest";
import { sandboxConfigPushAllowed } from "./plugin-config-sync";

describe("sandboxConfigPushAllowed", () => {
  it("blocks cross-post when editing another pack tile store id", () => {
    expect.hasAssertions();
    expect(sandboxConfigPushAllowed("pack-a", "pack-b")).toBe(false);
    expect(sandboxConfigPushAllowed("pack-a:tile-1", "pack-a")).toBe(false);
    expect(sandboxConfigPushAllowed("pack-a", "pack-a")).toBe(true);
    expect(sandboxConfigPushAllowed(null, "pack-a")).toBe(false);
  });
});
