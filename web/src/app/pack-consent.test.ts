import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginView } from "../plugins/plugin";
import { ensurePackReviewed, resetPackConsentSession } from "./pack-consent";
import * as pluginUi from "../plugins/plugin-ui";
import * as pluginMod from "../plugins/plugin";

function needsReviewSpec(): PluginView {
  return {
    id: "pack-review",
    name: "Review me",
    hash: "abc",
    capabilities: ["viz.read"],
    consent: null,
    config: {},
    options: [],
    instances: [],
  } as PluginView;
}

describe("ensurePackReviewed", () => {
  afterEach(() => {
    resetPackConsentSession();
    vi.restoreAllMocks();
  });

  it("goes through askPluginReview and grantPluginConsent (no localStorage bypass)", async () => {
    const spec = needsReviewSpec();
    vi.spyOn(pluginMod, "pluginNeedsReview").mockReturnValue(true);
    const ask = vi.spyOn(pluginUi, "askPluginReview").mockResolvedValue("allow");
    const grant = vi.spyOn(pluginMod, "grantPluginConsent").mockResolvedValue(undefined);
    const ok = await ensurePackReviewed(spec);
    expect(ok).toBe(true);
    expect(ask).toHaveBeenCalledWith(spec);
    expect(grant).toHaveBeenCalledWith("pack-review", "allow");
    expect(spec.consent).toBe("allow");
  });

  it("returns false when the user cancels review", async () => {
    const spec = needsReviewSpec();
    vi.spyOn(pluginMod, "pluginNeedsReview").mockReturnValue(true);
    vi.spyOn(pluginUi, "askPluginReview").mockResolvedValue(null);
    const grant = vi.spyOn(pluginMod, "grantPluginConsent");
    const ok = await ensurePackReviewed(spec);
    expect(ok).toBe(false);
    expect(grant).not.toHaveBeenCalled();
  });
});
