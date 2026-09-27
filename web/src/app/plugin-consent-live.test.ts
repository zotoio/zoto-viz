import { describe, expect, it } from "vitest";
import { mergePluginConsentLivePatch } from "./plugin-consent-live";
import type { PluginView } from "../plugins/plugin";

describe("mergePluginConsentLivePatch", () => {
  it("merges WebSocket pluginConsent onto catalog rows", () => {
    const specs: PluginView[] = [{
      id: "heat",
      name: "Heat",
      version: 1,
      engine: "graph",
      consent: null,
      has_sky_shader: true,
    }];
    const ok = mergePluginConsentLivePatch(specs, {
      pluginConsent: { id: "heat", kind: "reviewed" },
    });
    expect(ok).toBe(true);
    expect(specs[0].consent).toBe("reviewed");
    expect(specs[0].sky_available).toBe(true);
  });
});
