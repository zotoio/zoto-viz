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
    cfg: {} as { pluginSpecForMode?: (id: string) => unknown },
    previewName: (Mosaic.prototype as unknown as { previewName: (id: string) => string }).previewName,
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

describe("mosaic preview-only backdrop", () => {
  it("covers a preview pane with the theme background and the pack's name, and goes with the caption", () => {
    const m = fakeMosaic(["plugin:koi-pond", "plugin:voxel-world"]);
    m.cfg.pluginSpecForMode = (id) => (id === "plugin:koi-pond" ? { id: "koi-pond", packName: "Koi Pond" } : null);
    sync(m, (id) => id === "plugin:koi-pond");
    const koi = m.panes.get("plugin:koi-pond")!;
    const back = koi.querySelector(".mosaic-pane-preview-backdrop");
    expect(back?.querySelector(".mosaic-pane-preview-name")?.textContent).toBe("Koi Pond");
    expect(m.panes.get("plugin:voxel-world")!.querySelector(".mosaic-pane-preview-backdrop")).toBeNull();
    sync(m, (id) => id === "plugin:koi-pond");
    expect(koi.querySelectorAll(".mosaic-pane-preview-backdrop")).toHaveLength(1);
    sync(m, () => false);
    expect(koi.querySelector(".mosaic-pane-preview-backdrop")).toBeNull();
  });

  it("paints the backdrop opaque in the theme background, under the chrome and caption", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(import.meta.dirname, "../style.css"), "utf8");
    const rule = css.match(/\.mosaic-pane-preview-backdrop \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/background:\s*var\(--scene-bg, var\(--bg\)\);/);
    expect(rule).toMatch(/z-index:\s*2;/);
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

  it("never suffixes the view the select is running (selected label stays whole)", async () => {
    const { applyPluginCatalog, fillViewSelect } = await import("../plugins/plugin");
    const base = { version: 1, engine: "graph", base: "topology" } as const;
    applyPluginCatalog([
      { ...base, id: "koi-pond", packName: "Koi Pond" },
      { ...base, id: "voxel-world", packName: "Voxel World" },
    ] as never);
    const sel = document.createElement("select");
    fillViewSelect(sel, "plugin:voxel-world", () => " (full view only)");
    const label = (v: string) => [...sel.querySelectorAll("option")].find((o) => o.value === v)?.textContent;
    expect(label("plugin:voxel-world")).toMatch(/Voxel World$/);
    expect(sel.selectedOptions[0]?.textContent).toMatch(/Voxel World$/);
    expect(label("plugin:koi-pond")).toMatch(/Koi Pond \(full view only\)$/);
    applyPluginCatalog([]);
  });

  it("a maximised pane's picker has no suffix at all", async () => {
    const { applyPluginCatalog } = await import("../plugins/plugin");
    const base = { version: 1, engine: "graph", base: "topology" } as const;
    applyPluginCatalog([
      { ...base, id: "koi-pond", packName: "Koi Pond" },
      { ...base, id: "fractal-zoom", packName: "Fractal Zoom" },
    ] as never);
    const fill = Mosaic.prototype["fillPanePick" as never] as (this: unknown, s: HTMLSelectElement, id: string) => void;
    const self = { maximized: "plugin:koi-pond", cfg: { pickSuffix: () => " (full view only)" } };
    const sel = document.createElement("select");
    fill.call(self, sel, "plugin:koi-pond");
    expect(sel.textContent).not.toContain("full view only");
    self.maximized = null as never;
    fill.call(self, sel, "plugin:koi-pond");
    const label = (v: string) => [...sel.querySelectorAll("option")].find((o) => o.value === v)?.textContent;
    expect(label("plugin:fractal-zoom")).toMatch(/\(full view only\)$/);
    expect(label("plugin:koi-pond")).toMatch(/Koi Pond$/);
    applyPluginCatalog([]);
  });
});
