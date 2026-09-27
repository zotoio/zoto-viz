import { beforeEach, describe, expect, it } from "vitest";
import { shouldPromptPluginReview } from "./plugin-consent-mount";
import type { PluginView } from "../plugins/plugin";

const reviewed: PluginView = {
  id: "backrooms",
  name: "Backrooms",
  version: 1,
  engine: "graph",
  runtime: "typescript",
  has_frontend: true,
  consent: "reviewed",
};

describe("shouldPromptPluginReview", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("never prompts before catalog consent is loaded", () => {
    expect(shouldPromptPluginReview({ ...reviewed, consent: null }, false)).toBe(false);
  });

  it("does not prompt when every pack is already approved", () => {
    expect(shouldPromptPluginReview(reviewed, true)).toBe(false);
  });

  it("prompts only after catalog is ready and consent is missing", () => {
    expect(shouldPromptPluginReview({ ...reviewed, consent: null }, true)).toBe(true);
  });
});
