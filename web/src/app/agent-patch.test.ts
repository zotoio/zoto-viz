import { describe, expect, it, vi } from "vitest";
import type { ProfileSettings } from "../core/profiles";
import { createApplyAgentPatch, type AgentPatchHost } from "./agent-patch";

/**
 * Page fake: `applySettings` is the only path that re-applies the mode, so it is where the
 * sandbox frame for the view on screen gets torn down and created again.
 */
function page(mode = "plugin:koi-pond") {
  let cur = {
    mode, feed: {}, chat: {}, show: {}, filters: {}, anim: {}, dice: { on: false },
  } as unknown as ProfileSettings;
  const frames = { created: 0, torn: 0 };
  const host: AgentPatchHost = {
    reloadClient: vi.fn(),
    refreshPluginCatalogAndResume: vi.fn(async () => {}),
    mergeConsentPatch: vi.fn(() => true),
    hasConsentPending: vi.fn(() => false),
    resumeMosaicConsentPending: vi.fn(async () => {}),
    modeIds: () => ["topology", "plugin:koi-pond", "plugin:voxel-world"],
    diceOn: () => false,
    collectSettings: () => cur,
    applySettings: vi.fn((s: ProfileSettings) => {
      frames.torn++;
      frames.created++;
      cur = s;
    }),
    rollDice: vi.fn(async () => {}),
    syncTemper: vi.fn(),
    aiMosaicLayoutOn: () => false,
    mosaicTiles: () => null,
    writeAi: vi.fn(async () => {}),
  };
  return { host, frames, apply: createApplyAgentPatch(host), settings: () => cur };
}

describe("applyAgentPatch with live consent news (QE K4b)", () => {
  it("a consent broadcast for the pack on screen applies nothing and makes 0 frames", async () => {
    const p = page();
    await p.apply({ pluginConsent: { id: "koi-pond", kind: "authored" } });
    expect(p.host.mergeConsentPatch).toHaveBeenCalledTimes(1);
    expect(p.host.applySettings).toHaveBeenCalledTimes(0);
    expect(p.host.writeAi).toHaveBeenCalledTimes(0);
    expect(p.frames).toEqual({ created: 0, torn: 0 });
    expect(p.settings().mode).toBe("plugin:koi-pond");
  });

  it("a catalog reload alone refreshes the catalog and makes 0 frames", async () => {
    const p = page();
    await p.apply({ reloadPlugins: true });
    expect(p.host.refreshPluginCatalogAndResume).toHaveBeenCalledTimes(1);
    expect(p.host.applySettings).toHaveBeenCalledTimes(0);
    expect(p.host.writeAi).toHaveBeenCalledTimes(0);
    expect(p.frames).toEqual({ created: 0, torn: 0 });
  });

  it("consent plus a real settings change still merges consent and applies the change", async () => {
    const p = page();
    await p.apply({ pluginConsent: { id: "koi-pond", kind: "authored" }, mode: "topology" });
    expect(p.host.mergeConsentPatch).toHaveBeenCalledTimes(1);
    expect(p.host.applySettings).toHaveBeenCalledTimes(1);
    expect(p.settings().mode).toBe("topology");
    expect(p.host.writeAi).toHaveBeenCalledTimes(1);
  });

  it("a settings-only patch is unchanged by the consent early return", async () => {
    const p = page();
    await p.apply({ mode: "plugin:voxel-world" });
    expect(p.host.applySettings).toHaveBeenCalledTimes(1);
    expect(p.settings().mode).toBe("plugin:voxel-world");
    expect(p.host.writeAi).toHaveBeenCalledTimes(1);
  });
});
