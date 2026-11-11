import { describe, expect, it, vi } from "vitest";
import { Mosaic } from "./mosaic";

/** A pane reused for another view must name that view, not the one it was first built for. */
describe("mosaic preview backdrop name follows the pane's view", () => {
  it("renames the backdrop when the same pane element moves to another pack", () => {
    const pane = document.createElement("div");
    const names: Record<string, string> = { "plugin:marble-run": "Marble Run", "plugin:blob-mesh": "Blob Mesh" };
    const m = {
      on: true,
      panes: new Map([["plugin:marble-run", pane]]),
      maximized: null,
      toggleMax: vi.fn(),
      promote: vi.fn(),
      previewName: (id: string) => names[id] ?? id,
    };
    Reflect.apply(Mosaic.prototype.syncPreviewCaptions, m, [() => true]);
    expect(pane.querySelector(".mosaic-pane-preview-name")?.textContent).toBe("Marble Run");
    m.panes = new Map([["plugin:blob-mesh", pane]]);
    Reflect.apply(Mosaic.prototype.syncPreviewCaptions, m, [() => true]);
    expect(pane.querySelector(".mosaic-pane-preview-name")?.textContent).toBe("Blob Mesh");
    expect(pane.querySelectorAll(".mosaic-pane-preview-caption")).toHaveLength(1);
  });
});
