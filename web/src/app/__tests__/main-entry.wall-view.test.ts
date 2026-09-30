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

/**
 * The wall view ships its own plugin sky (backdrop: plugin) and its tiles ship none (backdrop:
 * none), like Syscon and Cypher CIC. Approved, so the sky may load.
 */
function skyWallPacks(w: WallCase): Record<string, unknown>[] {
  const packs = new Set([...w.tiles, START]);
  return [
    {
      ...packRow(w.wallId, w.name, { backdrop: "plugin", mosaic: "8", hero: w.hero, mosaicSharedTheme: true, mosaicTiles: w.tiles }),
      has_sky: true,
      has_sky_shader: true,
      shader_sha256: `${w.wallId}-sky`,
      consent: "authored",
    },
    ...[...packs].map((t) => packRow(t.replace("plugin:", ""), t, { backdrop: "none" })),
  ];
}

/** The tile the host's main scene sits in (the wall's main tile). */
function mainTileId(): string {
  return document.getElementById("scene")?.closest<HTMLElement>("[data-mode]")?.dataset.mode ?? "";
}

describe("main.ts wall view uses its own sky on its wall (#172c)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(WALLS)("wall view uses its own sky on a hero-$hero wall ($name, #172c)", async (w) => {
    expect.hasAssertions();
    const wallMode = `plugin:${w.wallId}`;
    localStorage.setItem("zoto-viz.mode", START);
    await bootMainEntry(skyWallPacks(w));
    await waitEntryBootComplete();
    expect(document.body.dataset.mosaic ?? "off").toBe("off");

    // A compilable fragment for the wall view's sky (the harness answers other /api/ paths with "{}").
    const harnessFetch = globalThis.fetch;
    vi.stubGlobal("fetch", ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input).includes(`/api/plugins/${w.wallId}/sky/`)
        ? Promise.resolve(new Response("void main() { gl_FragColor = vec4(0.0); }", { status: 200 }))
        : harnessFetch(input, init)) as typeof fetch);

    // Same module instance main.ts loaded (bootMainEntry resets modules before importing it).
    const { NetScene } = await import("../../graph/scene");
    type Scene = InstanceType<typeof NetScene>;
    const skies: { scene: Scene; id: string | null }[] = [];
    const setPluginShader = NetScene.prototype.setPluginShader;
    vi.spyOn(NetScene.prototype, "setPluginShader").mockImplementation(function (this: Scene, ...args) {
      skies.push({ scene: this, id: args[0]?.id ?? null });
      return setPluginShader.apply(this, args);
    });

    await pickModeFromUi(wallMode);
    await vi.waitFor(() => {
      expect(document.body.dataset.mosaic).toBe("8");
      expect(wallTileIds().length).toBeGreaterThan(0);
    }, { timeout: 8000 });
    const main = mainTileId();
    expect(w.tiles).toContain(main);

    // The wall's main tile gets the wall view's own sky, and its backdrop draws it.
    await vi.waitFor(() => {
      const onMain = skies.filter((s) => s.scene.currentMode.id === main).map((s) => s.id);
      expect(onMain, `setPluginShader on ${main}: ${JSON.stringify(skies.map((s) => [s.scene.currentMode.id, s.id]))}`)
        .toContain(w.wallId);
    }, { timeout: 4000 });
    const mainScene = skies.find((s) => s.scene.currentMode.id === main)!.scene;
    expect(mainScene.dreamAnim.backdrop, `${main} backdrop`).toBe("plugin");
    // The other tiles keep their own (sky-less) look: the wall sky is not on them.
    const others = skies.filter((s) => s.scene.currentMode.id !== main && s.id === w.wallId);
    expect(others.map((s) => s.scene.currentMode.id)).toEqual([]);
  });
});
