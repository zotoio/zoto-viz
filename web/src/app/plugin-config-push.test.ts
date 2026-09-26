import { describe, expect, it, vi } from "vitest";
import { SandboxConfigBatcher } from "./sandbox-config-batcher";
import { shouldPushSandboxConfig } from "./plugin-config-push";

describe("plugin config push to sandbox", () => {
  it("pushes when the loaded pack id matches", () => {
    expect(shouldPushSandboxConfig("settings-fixture", "settings-fixture")).toBe(true);
    expect(shouldPushSandboxConfig("settings-fixture", "topology")).toBe(false);
    expect(shouldPushSandboxConfig("", "settings-fixture")).toBe(false);
  });

  it("batch posts config for the loaded pack regardless of active view select", () => {
    const posted: { packId: string; config: Record<string, string> }[] = [];
    const batcher = new SandboxConfigBatcher(
      (packId, config) => {
        if (shouldPushSandboxConfig("settings-fixture", packId)) posted.push({ packId, config });
      },
      (cb) => { cb(); return 1; },
      vi.fn(),
    );
    batcher.schedule("settings-fixture", { gain: "0", preset: "custom", mode: "y", locked: "0" });
    expect(posted).toEqual([{
      packId: "settings-fixture",
      config: { gain: "0", preset: "custom", mode: "y", locked: "0" },
    }]);
  });
});
