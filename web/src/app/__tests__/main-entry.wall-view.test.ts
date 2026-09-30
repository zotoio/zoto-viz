/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootMainEntry, pickModeFromUi, waitEntryBootComplete } from "./main-entry-harness";

/** Graph pack row shaped like the /api/plugins catalog (no consent needed). */
function packRow(id: string, name: string, look: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    name,
    version: 1,
    engine: "graph",
    base: "topology",
    look,
    has_frontend: false,
    frontend: { entry: "frontend/index.ts" },
    capabilities: [],
    has_sky: false,
    has_sky_shader: false,
    has_backend: false,
    has_datasource: false,
  };
}

type WallCase = { name: string; wallId: string; hero: string; tiles: string[] };

/** Syscon (hero off) and Cypher CIC (hero center) shaped wall views over their own packs. */
const WALLS: WallCase[] = [
  { name: "Syscon", wallId: "syscon", hero: "off", tiles: ["plugin:cores", "plugin:memory"] },
  { name: "Cypher CIC", wallId: "cypher-cic", hero: "center", tiles: ["plugin:topology", "plugin:talkers", "plugin:protocols"] },
];

const START = "plugin:topology";

/** The wall view, its tile packs, and NET Topology (the solo view the repro starts from). */
function wallPacks(w: WallCase): Record<string, unknown>[] {
  const packs = new Set([...w.tiles, START]);
  return [
    packRow(w.wallId, w.name, { backdrop: "space", mosaic: "8", hero: w.hero, mosaicSharedTheme: true, mosaicTiles: w.tiles }),
    ...[...packs].map((t) => packRow(t.replace("plugin:", ""), t, { backdrop: "space" })),
  ];
}

function wallTileIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>("#wall [data-mode]")].map((el) => el.dataset.mode ?? "");
}

describe("main.ts wall view opens its wall (#172)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(WALLS)("opening $name from solo Topology keeps the wall's own tiles and the header on $name", async (w) => {
    expect.hasAssertions();
    const wallMode = `plugin:${w.wallId}`;
    localStorage.setItem("zoto-viz.mode", START);
    await bootMainEntry(wallPacks(w));
    await waitEntryBootComplete();
    expect(localStorage.getItem("zoto-viz.mode")).toBe(START);
    expect(document.body.dataset.mosaic ?? "off").toBe("off");

    // Same module instance main.ts loaded (bootMainEntry resets modules before importing it).
    const { NetScene } = await import("../../graph/scene");
    const scenes = new Set<InstanceType<typeof NetScene>>();
    const setMode = NetScene.prototype.setMode;
    vi.spyOn(NetScene.prototype, "setMode").mockImplementation(function (this: InstanceType<typeof NetScene>, ...args) {
      scenes.add(this);
      return setMode.apply(this, args);
    });

    await pickModeFromUi(wallMode);

    await vi.waitFor(() => {
      expect(document.body.dataset.mosaic).toBe("8");
      expect(wallTileIds().length).toBeGreaterThan(0);
    }, { timeout: 8000 });
    // Let the re-entrant switch (applyPluginWall -> setSize -> onAfterSetSize -> applyMode) settle.
    await new Promise((r) => setTimeout(r, 300));

    expect.soft([...wallTileIds()].sort(), "the wall keeps its own tiles").toEqual([...w.tiles].sort());
    expect.soft(wallTileIds()).not.toContain(wallMode);
    expect.soft(localStorage.getItem("zoto-viz.mode"), "the header stays on the wall view").toBe(wallMode);
    const paneModes = [...scenes].map((sc) => sc.currentMode.id);
    expect.soft(paneModes, "no tile's scene is re-moded to the wall view").not.toContain(wallMode);
  });
});
