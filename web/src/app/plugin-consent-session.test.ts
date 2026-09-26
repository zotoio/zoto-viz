import { afterEach, describe, expect, it, vi } from "vitest";
import { consentHash, hashConsented } from "../plugins/host";
import * as pluginUi from "../plugins/plugin-ui";
import * as pluginApi from "../plugins/plugin";
import { pluginNeedsReview, type PluginView } from "../plugins/plugin";

const pulseSpec = (): PluginView => ({
  id: "pulse-ts",
  name: "Pulse",
  version: 1,
  engine: "graph",
  runtime: "typescript",
  hash: "abc123",
  capabilities: ["viz.read"],
});

async function ensureReviewedLike(spec: PluginView | null): Promise<boolean> {
  if (!spec || !pluginNeedsReview(spec)) return true;
  if (spec.consent) return true;
  if (spec.hash && hashConsented(spec.id, spec.hash)) {
    spec.consent = "reviewed";
    return true;
  }
  const kind = await pluginUi.askPluginReview(spec);
  if (!kind) return false;
  await pluginApi.grantPluginConsent(spec.id, kind);
  spec.consent = kind;
  if (spec.hash) consentHash(spec.id, spec.hash);
  return true;
}

describe("plugin consent session", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("approves once, then wall changes and reload reuse stored hash without re-prompting", async () => {
    const ask = vi.spyOn(pluginUi, "askPluginReview").mockResolvedValue("reviewed");
    vi.spyOn(pluginApi, "grantPluginConsent").mockResolvedValue(undefined);

    expect(await ensureReviewedLike(pulseSpec())).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 3; i++) {
      const tile = pulseSpec();
      tile.consent = undefined;
      expect(await ensureReviewedLike(tile)).toBe(true);
    }
    expect(ask).toHaveBeenCalledTimes(1);

    const reloaded = pulseSpec();
    reloaded.consent = undefined;
    expect(await ensureReviewedLike(reloaded)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(hashConsented(reloaded.id, reloaded.hash!)).toBe(true);
  });
});
