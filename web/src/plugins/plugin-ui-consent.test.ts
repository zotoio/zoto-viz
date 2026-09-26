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
  it("focuses Not now on open and Enter declines", async () => {
    const pending = askPluginReview(spec);
    const cancel = document.querySelector(".modal.ask .ask-actions .btn") as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);
    expect(cancel.textContent).toBe("Not now");
    cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await expect(pending).resolves.toBeNull();
    expect(document.querySelector(".modal.ask")).toBeNull();
  });

  it("closes the dialog when AbortSignal aborts", async () => {
    const ac = new AbortController();
    const pending = askPluginReview(spec, { signal: ac.signal });
    expect(document.querySelector(".modal.ask")).toBeTruthy();
    ac.abort();
    await expect(pending).resolves.toBeNull();
    expect(document.querySelector(".modal.ask")).toBeNull();
  });
});
