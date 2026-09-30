/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootMainEntry, pickModeFromUi, waitEntryBootComplete } from "./main-entry-harness";

/**
 * Each row boots the real main.ts and lays out a wall: under box load (~30) the first boot alone
 * can pass the default 5 s, so this file has its own 30 s budget (#172 follow-up). A broken
 * expectation still fails on its own message long before that.
 */
const WALL_VIEW_TIMEOUT_MS = 30_000;
vi.setConfig({ testTimeout: WALL_VIEW_TIMEOUT_MS });

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

/** The same wall view with its own sky, not yet approved (consent needed, auto-consent off). */
function unapprovedWallPacks(w: WallCase): Record<string, unknown>[] {
  const [wall, ...rest] = skyWallPacks(w);
  return [{ ...wall, consent: null, consent_state: "none" }, ...rest];
}

/** The view the header names: the picker row marked selected. */
function headerViewId(): string {
  return document.querySelector<HTMLElement>(`#mode li[aria-selected="true"]`)?.dataset.value ?? "";
}

function wallPane(tileId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#wall .mosaic-pane[data-mode="${CSS.escape(tileId)}"]`);
}

describe("declined wall view shows Needs you (Syscon / Cypher CIC, #172)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(WALLS)("$name held for consent from solo Topology: its wall stays, the header stays on it, Needs you on its main tile", async (w) => {
    expect.hasAssertions();
    const wallMode = `plugin:${w.wallId}`;
    localStorage.setItem("zoto-viz.mode", START);
    await bootMainEntry(unapprovedWallPacks(w));
    await waitEntryBootComplete();
    expect(document.body.dataset.mosaic ?? "off").toBe("off");
    expect(headerViewId()).toBe(START);

    await pickModeFromUi(wallMode);
    await vi.waitFor(() => {
      expect(document.body.dataset.mosaic).toBe("8");
      expect(wallTileIds().length).toBeGreaterThan(0);
    }, { timeout: 8000 });
    const main = mainTileId();
    expect(w.tiles).toContain(main);
    // Needs you (B's copy and surface): the main tile and its own notice, with Review.
    await vi.waitFor(() => {
      expect(wallPane(main)?.dataset.viewState, `${main} view state`).toBe("needs-you");
    }, { timeout: 4000 });
    // Let the re-entrant switch (applyPluginWall -> setSize -> onAfterSetSize -> applyMode) settle.
    await new Promise((r) => setTimeout(r, 300));

    expect.soft([...wallTileIds()].sort(), "the wall keeps its own tiles").toEqual([...w.tiles].sort());
    expect.soft(wallTileIds()).not.toContain(wallMode);
    expect.soft(document.body.dataset.mosaic, "the wall stays up").toBe("8");
    expect.soft(headerViewId(), "the header stays on the wall view").toBe(wallMode);

    const pane = wallPane(main);
    expect.soft(pane?.dataset.viewState).toBe("needs-you");
    expect.soft(pane?.dataset.viewId).toBe(wallMode);
    const notice = pane?.querySelector<HTMLElement>(":scope > .mosaic-pane-notice");
    expect.soft(notice?.dataset.viewState).toBe("needs-you");
    expect.soft(notice?.dataset.viewId).toBe(wallMode);
    expect.soft(notice?.textContent ?? "").toContain(`${w.name} needs your OK to run.`);
    expect.soft(notice?.querySelector<HTMLButtonElement>("button[data-action=review]")?.textContent).toBe("Review");
  });
});

/** A wall view whose pack needs consent only for its backend: no sky and no frontend to load. */
function backendOnlyWallPacks(w: WallCase): Record<string, unknown>[] {
  const [wall, ...rest] = wallPacks(w);
  return [{ ...wall, has_backend: true, backend_sha256: `${w.wallId}-backend`, consent: null, consent_state: "none" }, ...rest];
}

/** The main tile's Needs you: state and view id on the tile and on its own notice, B's copy. */
function needsYouOn(tileId: string): { state: string; viewId: string; noticeState: string; noticeViewId: string; text: string; button: string } {
  const pane = wallPane(tileId);
  const notice = pane?.querySelector<HTMLElement>(":scope > .mosaic-pane-notice");
  return {
    state: pane?.dataset.viewState ?? "",
    viewId: pane?.dataset.viewId ?? "",
    noticeState: notice?.dataset.viewState ?? "",
    noticeViewId: notice?.dataset.viewId ?? "",
    text: notice?.textContent?.replace(/Review$/, "") ?? "",
    button: notice?.querySelector<HTMLButtonElement>("button[data-action=review]")?.textContent ?? "",
  };
}

async function waitForWall(): Promise<string> {
  await vi.waitFor(() => {
    expect(document.body.dataset.mosaic).toBe("8");
    expect(wallTileIds().length).toBeGreaterThan(0);
  }, { timeout: 8000 });
  return mainTileId();
}

/** Serve a compilable fragment for the wall view's sky (the harness answers other /api/ paths with "{}"). */
function stubWallSky(wallId: string): void {
  const harnessFetch = globalThis.fetch;
  vi.stubGlobal("fetch", ((input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input).includes(`/api/plugins/${wallId}/sky/`)
      ? Promise.resolve(new Response("void main() { gl_FragColor = vec4(0.0); }", { status: 200 }))
      : harnessFetch(input, init)) as typeof fetch);
}

/**
 * One row per Needs-you route for a wall view (#172 follow-up). Each row reaches only its own
 * route, so reverting that route alone turns only that row red:
 * - route (a), paintPluginNeedsReviewNotice's wall branch: the wall view's pack changes while its
 *   wall is up, and the next sky sync (a Settings pane swap on another tile) asks again;
 * - route (b), showNeedsYou in reviewWallView: the wall view is picked while its pack (backend
 *   only, so no sky or frontend ever loads) still needs consent.
 */
describe("one row per wall-view Needs-you route (#172 follow-up)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(WALLS)("route (a) paintPluginNeedsReviewNotice wall branch: $name's pack changes while its wall is up; the next sky sync names $name on its main tile", async (w) => {
    expect.hasAssertions();
    const wallMode = `plugin:${w.wallId}`;
    localStorage.setItem("zoto-viz.mode", START);
    const rows = skyWallPacks(w);
    await bootMainEntry(rows);
    await waitEntryBootComplete();
    stubWallSky(w.wallId);

    await pickModeFromUi(wallMode);
    const main = await waitForWall();
    expect(w.tiles).toContain(main);
    await new Promise((r) => setTimeout(r, 300));
    expect(needsYouOn(main).state, "approved: no Needs you yet").not.toBe("needs-you");

    // The monitor now reports new sky content for the wall view's pack: its grant no longer holds.
    Object.assign(rows[0]!, { consent: null, consent_state: "changed", shader_sha256: `${w.wallId}-sky-v2` });
    const host = await import("../apply-mode-test-host");
    await host.refreshCatalogForTests();

    // Swap another tile from Settings: the pane switch re-syncs every tile's sky, the wall's too.
    const other = wallTileIds().find((id) => id !== main)!;
    const slot = document.querySelector<HTMLSelectElement>(`.mosaic-pane-row[data-pane="${CSS.escape(other)}"] select.mosaic-slot`);
    expect(slot, `Settings slot for ${other}`).toBeTruthy();
    slot!.value = "plugin:harness-alt";
    slot!.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => { expect(needsYouOn(main).state, `${main} view state`).toBe("needs-you"); }, { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(needsYouOn(main)).toEqual({
      state: "needs-you",
      viewId: wallMode,
      noticeState: "needs-you",
      noticeViewId: wallMode,
      text: `${w.name} needs your OK again.`,
      button: "Review",
    });
    expect.soft(headerViewId(), "the header stays on the wall view").toBe(wallMode);
    expect.soft(document.body.dataset.mosaic, "the wall stays up").toBe("8");
  });

  it.each(WALLS)("route (b) reviewWallView: picking $name (backend-only pack) held for consent shows Needs you on its main tile", async (w) => {
    expect.hasAssertions();
    const wallMode = `plugin:${w.wallId}`;
    localStorage.setItem("zoto-viz.mode", START);
    await bootMainEntry(backendOnlyWallPacks(w));
    await waitEntryBootComplete();

    await pickModeFromUi(wallMode);
    const main = await waitForWall();
    expect(w.tiles).toContain(main);
    await vi.waitFor(() => { expect(needsYouOn(main).state, `${main} view state`).toBe("needs-you"); }, { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(needsYouOn(main)).toEqual({
      state: "needs-you",
      viewId: wallMode,
      noticeState: "needs-you",
      noticeViewId: wallMode,
      text: `${w.name} needs your OK to run.`,
      button: "Review",
    });
    expect.soft([...wallTileIds()].sort(), "the wall keeps its own tiles").toEqual([...w.tiles].sort());
    expect.soft(headerViewId(), "the header stays on the wall view").toBe(wallMode);
  });
});
