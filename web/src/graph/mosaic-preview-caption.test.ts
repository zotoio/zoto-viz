import { describe, expect, it, vi } from "vitest";
import { Mosaic } from "./mosaic";

function fakeMosaic(ids: string[]) {
  const panes = new Map(ids.map((id) => [id, document.createElement("div")] as const));
  return {
    on: true,
    panes,
    maximized: null as string | null,
    toggleMax: vi.fn(),
    promote: vi.fn(),
  };
}

const sync = (m: ReturnType<typeof fakeMosaic>, pred: (id: string) => boolean) =>
  (Mosaic.prototype.syncPreviewCaptions as (this: unknown, p: (id: string) => boolean) => void).call(m, pred);

describe("mosaic preview-only caption", () => {
  it("captions only panes without a sandbox, and Open full view does the tile's max", () => {
    const m = fakeMosaic(["plugin:voxel-world", "plugin:koi-pond", "topology"]);
    sync(m, (id) => id === "plugin:koi-pond");
    const koi = m.panes.get("plugin:koi-pond")!;
    const cap = koi.querySelector(".mosaic-pane-preview-caption");
    expect(cap?.textContent).toBe("Preview only · Open full view");
    expect(m.panes.get("plugin:voxel-world")!.querySelector(".mosaic-pane-preview-caption")).toBeNull();
    koi.querySelector<HTMLButtonElement>(".mosaic-pane-preview-open")!.click();
    expect(m.toggleMax).toHaveBeenCalledWith("plugin:koi-pond");
  });

  it("removes the caption when the pane gets the sandbox or the mosaic is off", () => {
    const m = fakeMosaic(["plugin:koi-pond"]);
    sync(m, () => true);
    sync(m, () => true);
    expect(m.panes.get("plugin:koi-pond")!.querySelectorAll(".mosaic-pane-preview-caption")).toHaveLength(1);
    sync(m, () => false);
    expect(m.panes.get("plugin:koi-pond")!.querySelector(".mosaic-pane-preview-caption")).toBeNull();
    m.on = false;
    sync(m, () => true);
    expect(m.panes.get("plugin:koi-pond")!.querySelector(".mosaic-pane-preview-caption")).toBeNull();
  });
});

describe("mosaic pane picker suffix", () => {
  it("marks sandboxed packs '(full view only)' and leaves the rest alone", async () => {
    const { applyPluginCatalog, fillViewSelect } = await import("../plugins/plugin");
    const base = { version: 1, engine: "graph", base: "topology" } as const;
    applyPluginCatalog([
      { ...base, id: "koi-pond", packName: "Koi Pond" },
      { ...base, id: "heat", packName: "Heat" },
    ] as never);
    const sel = document.createElement("select");
    fillViewSelect(sel, "plugin:heat", (v) => (v === "plugin:koi-pond" ? " (full view only)" : ""));
    const label = (v: string) => [...sel.querySelectorAll("option")].find((o) => o.value === v)?.textContent;
    expect(label("plugin:koi-pond")).toMatch(/Koi Pond \(full view only\)$/);
    expect(label("plugin:heat")).toMatch(/Heat$/);
    applyPluginCatalog([]);
  });
});
