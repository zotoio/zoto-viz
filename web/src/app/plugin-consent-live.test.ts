import { describe, expect, it } from "vitest";
import { livePatchIsConsentOnly, mergePluginConsentLivePatch } from "./plugin-consent-live";
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

describe("consent live patch never re-applies the mode (QE K4b)", () => {
  it("classifies consent / catalog-only patches", () => {
    expect(livePatchIsConsentOnly({ pluginConsent: { id: "koi-pond", kind: "authored" } })).toBe(true);
    expect(livePatchIsConsentOnly({ reloadPlugins: true })).toBe(true);
    expect(livePatchIsConsentOnly({ pluginConsent: { id: "k", kind: "authored" }, mode: "topology" })).toBe(false);
    expect(livePatchIsConsentOnly({})).toBe(false);
  });
});
