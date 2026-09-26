import { DEFAULT_DREAM, NetScene, type DreamAnim, type Filters } from "../graph/scene";
import { Mosaic } from "../graph/mosaic";
import { themeById } from "../core/themes";
import type { Settings } from "../ui/settings";
import { applyWallLayoutPatch } from "./mosaic-wall-layout";
import { bindThisView, type BindThisViewDeps } from "./host-view-bind";
import { createMosaicPanePickHandler } from "./host-mosaic-pane-pick";
import { syncSettingsAnimToMosaic } from "./settings-mosaic-anim-sync";

export function stubNetSceneForMosaic(): NetScene {
  return {
    currentMode: { id: "plugin:topology" },
    currentTheme: themeById("midnight"),
    currentFilters: {
      lan: true,
      internet: true,
      multicast: true,
      offline: true,
      labels: true,
      cpuIdle: true,
    } satisfies Filters,
    setAnim: () => {},
    setCompactLabels: () => {},
    relayout: () => {},
    setMode: () => {},
    setPackCoalesce: () => {},
    dreamAnim: DEFAULT_DREAM,
    pluginSkyId: null,
  } as unknown as NetScene;
}

export type DuplicateSlotMosaicHarness = {
  mosaic: Mosaic;
  wall: HTMLElement;
  bindThisView: (modeId: string) => void;
  applyMode: (modeId: string, flags?: { keepLayout?: boolean }) => void;
};

export function mountDuplicateSlotMosaicHarness(
  settings: Settings,
  bindDeps: Omit<BindThisViewDeps, "settings"> & { fallbackModeId: () => string },
): DuplicateSlotMosaicHarness {
  const wall = document.createElement("div");
  const sceneEl = document.createElement("div");
  document.body.append(wall, sceneEl);
  const scene = stubNetSceneForMosaic();
  let mosaic!: Mosaic;
  const bindThisViewForMode = (modeId: string) => {
    bindThisView({ settings, ...bindDeps }, modeId);
  };
  const applyMode = (modeId: string, flags: { keepLayout?: boolean } = {}) => {
    if (!flags.keepLayout) bindThisViewForMode(modeId);
  };
  mosaic = new Mosaic({
    wall,
    sceneEl,
    main: scene,
    arcade: {},
    optsFor: () => ({}),
    onFocus: () => {},
    onPromote: () => {},
    onCloseLast: () => {
      settings.applyAnim({
        ...settings.animSettings,
        mosaic: "off",
        mosaicTree: null,
        mosaicMaxId: "",
        mosaicTiles: [],
      });
    },
    onLayout: (patch) => {
      applyWallLayoutPatch(settings, patch);
    },
    sync: () => ({
      theme: scene.currentTheme,
      filters: scene.currentFilters,
      anim: settings.animSettings,
      dreaming: false,
      nodeFilter: () => true,
      lastMsg: null,
      aliasMap: new Map(),
    }),
  });
  settings.onMosaicPanePick = createMosaicPanePickHandler({
    getMosaic: () => mosaic,
    hostModeById: bindDeps.hostModeById,
    pluginSpecForMode: bindDeps.pluginSpecForMode,
  });
  settings.addAnimation((a) => {
    syncSettingsAnimToMosaic({
      mosaic,
      scene,
      modeId: bindDeps.fallbackModeId(),
      pinViewLook: false,
      soloAnim: (anim) => scene.setAnim(anim),
      applyMode,
    }, a);
  }, { el: document.createElement("div") });
  return { mosaic, wall, bindThisView: bindThisViewForMode, applyMode };
}

export function applyMosaicTiles(settings: Settings, mosaic: Mosaic, tiles: string[]): void {
  const anim: DreamAnim = {
    ...settings.animSettings,
    mosaic: "4",
    mosaicTiles: tiles,
    mosaicTree: null,
    mosaicMaxId: "",
  };
  settings.applyAnim(anim);
  if (mosaic.on) mosaic.assignViews(tiles);
}

/** Drive layout like the drawer's `.mosaic-slot` picker (main `onMosaicPanePick`). */
export function pickMosaicSlot(settings: Settings, paneIndex: number, toViewId: string): void {
  const sel = settings.drawerEl.querySelectorAll<HTMLSelectElement>(".mosaic-slot")[paneIndex];
  if (!sel) throw new Error(`missing mosaic-slot pane ${paneIndex}`);
  sel.value = toViewId;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}
