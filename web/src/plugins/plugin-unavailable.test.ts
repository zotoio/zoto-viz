/**
 * #169: packs the service keeps in the catalog but can't load. Listed (greyed out) where a person
 * looks, kept on a saved tile with a notice, skipped silently by every automatic pick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installPlugins,
  viewPickerBanner,
  viewPickerOptions,
  viewSelectOptions,
  applyPluginCatalog,
} from "./plugin";
import {
  resetUnavailableCatalogForTests,
  setUnavailableCatalog,
  unavailableBanner,
  unavailablePickerLabel,
  unavailableTileNotice,
  UNAVAILABLE_VIEW_PREFIX,
} from "./plugin-unavailable";
import { defaultCatalogMode, modeById } from "../core/modes";
import { mosaicPanePool, Mosaic } from "../graph/mosaic";
import { hostModeById } from "../app/host-mode";
import { modeForDigitKey } from "../app/header-digit-mode";
import { dogfoodPackIds, runDogfoodCountGate } from "./dogfood-runner";
import { Select } from "../ui/ui";

const FIX = "Run `pnpm install` in `web/` on the server, then reload.";

const base = {
  has_frontend: false, capabilities: [], has_sky: false, has_sky_shader: false, has_backend: false, has_datasource: false,
};
const TOPO = { ...base, id: "topology", name: "Topology", version: 1, engine: "graph", look: { backdrop: "space" } };
const PULSE = { ...base, id: "pulse", name: "Pulse", version: 1, engine: "graph", base: "topology", look: { backdrop: "matrix" } };
/** Manifest-shaped rows marked unavailable, as a service that inlines them in `plugins` would send. */
const KOI_ROW = { ...base, id: "koi-pond", name: "Koi Pond", version: 1, engine: "graph", base: "topology", available: false, reason: "esbuild_unavailable" };
const KEF_ROW = { ...base, id: "kefrens-bars", name: "Kefrens Bars", version: 1, engine: "graph", base: "topology", available: false, reason: "esbuild_unavailable" };

/** GET /api/plugins with esbuild missing on the server (service/plugins.py `unavailable`). */
function catalogPayload() {
  return {
    dir: "", schema: "", errors: [], blocked: [],
    plugins: [TOPO, PULSE, KOI_ROW, KEF_ROW],
    unavailable: [
      { id: "koi-pond", name: "Koi Pond", file: "/srv/zv/plugins/src/koi-pond/plugin.yml", available: false, reason: "esbuild_unavailable", version: 1 },
      { id: "kefrens-bars", name: "Kefrens Bars", file: "/srv/zv/plugins/src/kefrens-bars/plugin.yml", available: false, reason: "esbuild_unavailable", version: 1 },
      { id: "blob-mesh", name: "Blob Mesh", file: "/srv/zv/plugins/src/blob-mesh/plugin.yml", available: false, reason: "bundle_failed", version: 1 },
    ],
  };
}

async function installUnavailableCatalog(): Promise<void> {
  vi.stubGlobal("fetch", (async () => ({ ok: true, json: async () => catalogPayload() })) as never);
  await installPlugins();
}

beforeEach(() => resetUnavailableCatalogForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  resetUnavailableCatalogForTests();
  applyPluginCatalog([]);
});

describe("#169 copy (UX Pro, word for word)", () => {
  it("pins every sentence; no path, rule id or raw error in user text", () => {
    const koi = { id: "koi-pond", name: "Koi Pond", reason: "esbuild_unavailable" };
    const blob = { id: "blob-mesh", name: "Blob Mesh", reason: "bundle_failed" };
    expect(unavailablePickerLabel(koi)).toBe("Koi Pond can't load until setup is finished.");
    expect(unavailableTileNotice(koi)).toBe(`Koi Pond can't load until setup is finished. ${FIX}`);
    expect(unavailablePickerLabel(blob)).toBe(
      "Blob Mesh couldn't be prepared, so it isn't available. Check the server log for details.",
    );
    expect(unavailableTileNotice(blob)).toBe(unavailablePickerLabel(blob));
    expect(unavailableBanner([koi])).toBe(`1 pack can't load until setup is finished. ${FIX}`);
    expect(unavailableBanner([koi, { ...koi, id: "k2", name: "K2" }, blob])).toBe(
      `2 packs can't load until setup is finished. ${FIX}`,
    );
    expect(unavailableBanner([blob])).toBeNull();
    const all = [unavailablePickerLabel(koi), unavailableTileNotice(koi), unavailableTileNotice(blob), unavailableBanner([koi])!];
    for (const text of all) expect(text).not.toMatch(/esbuild|bundle_failed|koi-pond|\/srv\/|plugin\.yml|Cannot find/);
  });
});

describe("#169 picker lists unavailable packs greyed out", () => {
  it("adds each unavailable pack after the available rows, disabled, with one setup banner", async () => {
    await installUnavailableCatalog();
    const opts = viewPickerOptions();
    const firstDisabled = opts.findIndex((o) => o.disabled);
    expect(firstDisabled).toBeGreaterThan(0);
    expect(opts.slice(0, firstDisabled).every((o) => !o.disabled)).toBe(true);
    expect(opts.slice(firstDisabled)).toEqual([
      { value: `${UNAVAILABLE_VIEW_PREFIX}blob-mesh`, label: "Blob Mesh couldn't be prepared, so it isn't available. Check the server log for details.", hint: "", group: "unavailable", disabled: true },
      { value: `${UNAVAILABLE_VIEW_PREFIX}kefrens-bars`, label: "Kefrens Bars can't load until setup is finished.", hint: "", group: "unavailable", disabled: true },
      { value: `${UNAVAILABLE_VIEW_PREFIX}koi-pond`, label: "Koi Pond can't load until setup is finished.", hint: "", group: "unavailable", disabled: true },
    ]);
    expect(viewPickerBanner()).toBe(`2 packs can't load until setup is finished. ${FIX}`);
  });

  it("a greyed-out row can't be picked, and the banner is one note, not an option", async () => {
    await installUnavailableCatalog();
    const onChange = vi.fn();
    const sel = new Select({ caption: "view", options: viewPickerOptions(), value: "plugin:topology", onChange });
    sel.setBanner(viewPickerBanner());
    document.body.append(sel.el);
    sel.open();
    const menu = sel.el.ownerDocument.getElementById(sel.el.querySelector("button")!.getAttribute("aria-controls")!)!;
    const notes = menu.querySelectorAll("li.menu-banner[role='note']");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toBe(`2 packs can't load until setup is finished. ${FIX}`);
    const koi = menu.querySelector<HTMLLIElement>(`li[data-value='${UNAVAILABLE_VIEW_PREFIX}koi-pond']`)!;
    expect(koi.getAttribute("aria-disabled")).toBe("true");
    expect(koi.textContent).toBe("Koi Pond can't load until setup is finished.");
    koi.click();
    expect(onChange).not.toHaveBeenCalled();
    sel.value = `${UNAVAILABLE_VIEW_PREFIX}koi-pond`;
    expect(sel.value).not.toBe(`${UNAVAILABLE_VIEW_PREFIX}koi-pond`);
    sel.close();
    sel.el.remove();
  });
});

describe("#169 saved tile on an unavailable pack", () => {
  function wallMosaic(setMode: ReturnType<typeof vi.fn>): Mosaic {
    return new Mosaic({
      wall: document.createElement("div"),
      sceneEl: document.createElement("div"),
      main: { currentMode: { id: "plugin:topology" }, setCompactLabels: () => {}, relayout: () => {}, setMode, retargetPanel: () => {} } as never,
      arcade: {},
      optsFor: () => ({}),
      onFocus: () => {},
      onPromote: () => {},
      onLayout: () => {},
      onCloseLast: () => {},
      sync: () => ({
        theme: { id: "midnight" } as never, filters: {}, anim: {} as never, dreaming: false,
        nodeFilter: () => true, lastMsg: null, aliasMap: new Map(),
      }),
    });
  }

  it("keeps its slot and shows the notice; nothing is mounted in its place", async () => {
    await installUnavailableCatalog();
    const setMode = vi.fn();
    const mosaic = wallMosaic(setMode);
    const pane = (mosaic as unknown as { ensurePane(id: string): HTMLElement }).ensurePane("plugin:koi-pond!2");
    expect((mosaic as unknown as { panes: Map<string, HTMLElement> }).panes.get("plugin:koi-pond!2")).toBe(pane);
    expect(pane.dataset.mode).toBe("plugin:koi-pond!2");
    expect(pane.querySelector(".mosaic-pane-notice-text")?.textContent).toBe(
      `Koi Pond can't load until setup is finished. ${FIX}`,
    );
    expect(setMode).not.toHaveBeenCalled();
    expect(pane.querySelector("select.mosaic-pick")?.textContent).not.toContain("koi-pond");
  });
});

describe("#169 automatic picks skip unavailable packs silently", () => {
  it("wall fill: the pane pool and default slots never hold an unavailable pack", async () => {
    await installUnavailableCatalog();
    expect(mosaicPanePool()).toContain("plugin:pulse");
    expect(mosaicPanePool()).not.toContain("plugin:koi-pond");
    expect(mosaicPanePool()).not.toContain("plugin:kefrens-bars");
    const autoSlots = viewSelectOptions().map((o) => o.value);
    expect(autoSlots.some((v) => /koi-pond|kefrens-bars|blob-mesh/.test(v))).toBe(false);
    const digits = ["1", "2", "3", "4", "5"].map((k) => String(modeForDigitKey(k)));
    expect(digits.some((v) => /koi-pond|kefrens-bars|blob-mesh|__unavailable__/.test(v))).toBe(false);
  });

  it("apply-mode: a view id on an unavailable pack resolves to a loadable mode, never the pack", async () => {
    await installUnavailableCatalog();
    expect(modeById("plugin:koi-pond").pluginId).not.toBe("koi-pond");
    expect(hostModeById("plugin:koi-pond").pluginId).not.toBe("koi-pond");
    expect(defaultCatalogMode()?.pluginId).toBe("topology");
  });

  it("dogfood: an unavailable demo pack is not run", async () => {
    await installUnavailableCatalog();
    expect(dogfoodPackIds()).not.toContain("kefrens-bars");
    expect(dogfoodPackIds()).toContain("talker-storm");
    const gate = runDogfoodCountGate({ framesPerPack: 1 });
    expect(gate.packs.map((p) => p.packId)).not.toContain("kefrens-bars");
    setUnavailableCatalog([]);
    expect(dogfoodPackIds()).toContain("kefrens-bars");
  });
});
