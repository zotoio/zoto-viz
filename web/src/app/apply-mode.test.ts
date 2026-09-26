import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginSandbox } from "../plugins/host";
import { defaultVizContract } from "../plugins/viz-host";
import type { ViewMode } from "../core/modes";
import type { PluginView } from "../plugins/plugin";
import { Select } from "../ui/ui";
import { VizHud } from "../ui/viz-hud";
import { applyModeImpl, type ApplyModeHost } from "./apply-mode";
import { getPresentDriveTileId, refreshPluginDriveState } from "./present-drive-app";

const backroomsSpec: PluginView = {
  id: "backrooms",
  name: "Backrooms",
  version: 1,
  capabilities: ["viz.write"],
  viz: defaultVizContract({ presentTick: true }),
};
const stereoSpec: PluginView = {
  id: "stereo-gram",
  name: "Stereo",
  version: 1,
  capabilities: ["viz.write"],
  viz: defaultVizContract({ presentTick: true }),
};

function mode(id: string, pluginId: string, label: string): ViewMode {
  return {
    id,
    pluginId,
    label,
    hint: label,
    graphBase: "topology",
    standalone: false,
    stageOnly: false,
    kind: "plugin",
    legend: () => [],
    options: [],
    config: {},
  } as ViewMode;
}

function buildHost(overrides: Partial<ApplyModeHost> & { ensureReviewed: ApplyModeHost["ensureReviewed"] }): ApplyModeHost {
  const sandbox = new PluginSandbox();
  const presentDriveDeps = { sandbox, pluginClock: () => 0, stageAspect: () => 16 / 9 };
  refreshPluginDriveState(backroomsSpec, "plugin:backrooms", presentDriveDeps);

  const sceneEl = document.createElement("div");
  sceneEl.id = "scene";
  if (!document.getElementById("hint")) {
    const foot = document.createElement("div");
    foot.id = "foot";
    foot.innerHTML = "<div id=\"hint\"></div><div id=\"legend\"></div>";
    document.body.appendChild(foot);
  }
  document.body.append(sceneEl);

  const modeSel = new Select({
    caption: "view",
    options: [
      { value: "plugin:backrooms", label: "Backrooms" },
      { value: "plugin:stereo-gram", label: "Stereo" },
    ],
    value: "plugin:backrooms",
    onChange: () => {},
  });
  document.body.appendChild(modeSel.el);
  const vizHud = new VizHud(sceneEl, () => {});
  vizHud.setActive("backrooms", "Backrooms");

  let live = "plugin:backrooms";
  const specs: Record<string, PluginView> = {
    "plugin:backrooms": backroomsSpec,
    "plugin:stereo-gram": stereoSpec,
  };
  const modes: Record<string, ViewMode> = {
    "plugin:backrooms": mode("plugin:backrooms", "backrooms", "Backrooms"),
    "plugin:stereo-gram": mode("plugin:stereo-gram", "stereo-gram", "Stereo"),
  };

  const bindThisView = vi.fn();
  const host: ApplyModeHost = {
    modeById: (id) => modes[id]!,
    optsFor: () => ({}),
    getLiveMode: () => live,
    setLiveMode: (id) => { live = id; },
    modeSel,
    touch: () => {},
    applyPluginWall: () => {},
    pluginSpecForMode: (id) => specs[id] ?? null,
    skySpecForMode: (_id, fb) => fb,
    refreshPluginDrive: (spec, modeId) => refreshPluginDriveState(spec, modeId, presentDriveDeps),
    presentDriveDeps,
    applySkyPrompt: () => {},
    reapplyCommittedModeSurfaces: (modeId) => {
      bindThisView(modeId);
      const m = modes[modeId]!;
      const spec = specs[modeId] ?? null;
      host.syncModeHud(m, spec);
    },
    computeSkyStage: () => false,
    applyStageOnly: () => {},
    applyModeFeedExtras: () => {},
    bindThisView,
    clearModeOpts: () => {},
    ensureReviewed: overrides.ensureReviewed,
    loadTsPlugin: vi.fn(async () => {}),
    syncPluginSky: vi.fn(async () => {}),
    mosaic: null,
    settingsAnim: () => ({
      mosaic: "off",
      hero: "off",
      mosaicTree: null,
      mosaicMaxId: "",
      mosaicTiles: [],
    } as ApplyModeHost["settingsAnim"] extends () => infer R ? R : never),
    captureMosaicSnap: () => ({
      size: "2",
      hero: "off",
      tree: null,
      maximized: null,
      tiles: [],
    }),
    restoreMosaicSnap: vi.fn(),
    mosaicSetSizeForMode: vi.fn(),
    mosaicShouldResize: () => false,
    mosaicSetPaneView: () => true,
    mosaicFocusSlot: () => "topology",
    mosaicHasTile: () => false,
    applyMosaicModeVisuals: vi.fn(),
    applySoloModeVisuals: vi.fn(),
    syncModeHud: (m, spec) => vizHud.setActive(m.pluginId ?? spec?.id ?? null, spec?.name ?? m.label),
    applyViewLook: () => {},
    feedSetGraphBase: () => {},
    syncWifiIfNeeded: () => {},
    modeLabel: (m) => m.label,
    onConsentDeclined: () => {},
    shouldLoadPluginRuntime: () => true,
    ...overrides,
  };
  return Object.assign(host, { bindThisViewSpy: bindThisView });
}

type TestHost = ApplyModeHost & { bindThisViewSpy: ReturnType<typeof vi.fn> };

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("applyModeImpl rollback", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.querySelectorAll("iframe").forEach((el) => el.remove());
  });

  it("restores picker, HUD, focus, message, and present drive after consent decline", async () => {
    const host = buildHost({ ensureReviewed: async () => false }) as TestHost;
    applyModeImpl(host, "plugin:stereo-gram", {});
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:backrooms");
    expect(host.bindThisViewSpy).toHaveBeenCalledWith("plugin:backrooms");
    expect(document.getElementById("hint")?.textContent).toContain("Couldn't load Stereo");
    expect(document.getElementById("hint")?.textContent).toContain("kept Backrooms");
    expect(document.activeElement).toBe(host.modeSel.el.querySelector("button"));
    expect(getPresentDriveTileId()).toBe("backrooms");
  });

  it("restores after mosaic setPaneView failure", async () => {
    const mosaicSetSizeForMode = vi.fn();
    const restoreMosaicSnap = vi.fn();
    const host = buildHost({
      ensureReviewed: async () => true,
      mosaic: {
        on: true,
        heroPos: "left",
        heroMode: "plugin:backrooms",
        current: "2",
        tileIds: ["topology"],
        focusedId: "topology",
        setPaneView: () => false,
        setSize: vi.fn(),
      } as ApplyModeHost["mosaic"],
      mosaicShouldResize: () => true,
      mosaicHasTile: () => false,
      mosaicSetPaneView: () => false,
      mosaicSetSizeForMode,
      restoreMosaicSnap,
    });
    applyModeImpl(host, "plugin:stereo-gram", {});
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:backrooms");
    expect(mosaicSetSizeForMode).toHaveBeenCalled();
    expect(restoreMosaicSnap).toHaveBeenCalled();
    expect(document.getElementById("hint")?.textContent).toMatch(/Couldn't load Stereo/);
    expect(getPresentDriveTileId()).toBe("backrooms");
  });

  it("does not run plugin load after mosaic failure rolled back present drive", async () => {
    const loadTs = vi.fn(async () => {
      refreshPluginDriveState(stereoSpec, "plugin:stereo-gram", buildHost({ ensureReviewed: async () => true }).presentDriveDeps);
    });
    const host = buildHost({
      ensureReviewed: async () => true,
      loadTsPlugin: loadTs,
      mosaic: {
        on: true,
        heroPos: "off",
        heroMode: "plugin:backrooms",
        current: "2",
        tileIds: ["topology"],
        focusedId: "topology",
        setPaneView: () => false,
        setSize: vi.fn(),
      } as ApplyModeHost["mosaic"],
      mosaicHasTile: () => false,
      mosaicSetPaneView: () => false,
    });
    applyModeImpl(host, "plugin:stereo-gram", {});
    await flushMicrotasks();
    expect(loadTs).not.toHaveBeenCalled();
    expect(getPresentDriveTileId()).toBe("backrooms");
  });
});
