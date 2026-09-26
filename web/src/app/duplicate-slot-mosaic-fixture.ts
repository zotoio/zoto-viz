import { DEFAULT_DREAM, NetScene, type DreamAnim, type Filters } from "../graph/scene";
import { Mosaic } from "../graph/mosaic";
import { themeById } from "../core/themes";
import type { Settings } from "../ui/settings";
import { applyWallLayoutPatch } from "./mosaic-wall-layout";
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

export function mountDuplicateSlotMosaicHarness(settings: Settings): {
  mosaic: Mosaic;
  wall: HTMLElement;
} {
  const wall = document.createElement("div");
  const sceneEl = document.createElement("div");
  document.body.append(wall, sceneEl);
  const scene = stubNetSceneForMosaic();
  const mosaic = new Mosaic({
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
  settings.addAnimation((a) => {
    syncSettingsAnimToMosaic({
      mosaic,
      scene,
      modeId: "plugin:settings-fixture",
      pinViewLook: false,
      soloAnim: (anim) => scene.setAnim(anim),
      applyMode: () => {},
    }, a);
  }, { el: document.createElement("div") });
  return { mosaic, wall };
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
