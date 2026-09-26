import { describe, expect, it } from "vitest";
import type { PluginView } from "./plugin";
import { askPluginReview } from "./plugin-ui";

const spec: PluginView = {
  id: "pack-a",
  name: "Pack A",
  version: 1,
  has_frontend: true,
  runtime: "typescript",
};

describe("askPluginReview", () => {
  it("closes the dialog when AbortSignal aborts", async () => {
    const ac = new AbortController();
    const pending = askPluginReview(spec, { signal: ac.signal });
    expect(document.querySelector(".modal.ask")).toBeTruthy();
    ac.abort();
    await expect(pending).resolves.toBeNull();
    expect(document.querySelector(".modal.ask")).toBeNull();
  });
});
