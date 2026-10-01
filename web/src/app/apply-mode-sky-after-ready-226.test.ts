/**
 * #226: a pick's pack sky installs after the pack's ready (loadTsPlugin resolved), so the sky
 * shader compiles once the handshake is done rather than alongside it. While that sky compile is
 * still pending the tile stays on starting through the existing sky-wait skip (tileSkyStarting):
 * no couldn't-start and no early ready.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewMode } from "../core/modes";
import type { PluginView } from "../plugins/plugin";
import { PluginSandbox } from "../plugins/host";
import { Select } from "../ui/ui";
import { applyModeImpl, viewLookSyncsSky, type ApplyModeHost } from "./apply-mode";
import { noteConsentGranted, resetConsentStoreForTests } from "./consent-store";
import { beginModeSwitchAttempt, resetModeSwitchAttemptForTests } from "./mode-switch-attempt";
import { beginCoordinatedModeSwitch, resetModeSwitchCoordinatorForTests } from "./mode-switch-coordinator";
import { clearModeSwitchStatus } from "./mode-switch-message";
import { resetModeSwitchStateForTests, setLastConsentedModeId } from "./mode-switch-state";
import { resetNeedsYouForTests } from "./needs-you";
import { resetPackConsentForTests } from "./pack-consent";
import { resetViewStatesForTests, viewStateOf } from "./view-state";

const PACK_MODE = "plugin:aurora-sky";
const PREV_MODE = "plugin:stereo-gram";

const auroraSpec: PluginView = {
  id: "aurora-sky",
  name: "Aurora",
  version: 1,
  runtime: "typescript",
  has_sky_shader: true,
  capabilities: ["viz.write"],
};
const stereoSpec: PluginView = { id: "stereo-gram", name: "Stereo", version: 1, capabilities: ["viz.write"] };

function viewMode(id: string, pluginId: string, label: string): ViewMode {
  return { id, pluginId, label, hint: label, kind: "demo", legend: () => [] };
}

type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

/**
 * Collaborators only: applyViewLook is wired like main.ts (it syncs the sky unless
 * viewLookSyncsSky says the sky waits for ready); loadTsPlugin and syncPluginSky are spies
 * that log "ready" when the pack's ready lands and "sky" when a sky compile is asked for.
 */
function harness(opts: { ready: Deferred; sky?: Deferred; skyStarting?: () => boolean }) {
  const order: string[] = [];
  const specs: Record<string, PluginView> = { [PACK_MODE]: auroraSpec, [PREV_MODE]: stereoSpec };
  const modes: Record<string, ViewMode> = {
    [PACK_MODE]: viewMode(PACK_MODE, "aurora-sky", "Aurora"),
    [PREV_MODE]: viewMode(PREV_MODE, "stereo-gram", "Stereo"),
  };
  const root = document.createElement("div");
  root.id = "scene";
  const modeSel = new Select({
    caption: "view",
    options: [
      { value: PREV_MODE, label: "Stereo" },
      { value: PACK_MODE, label: "Aurora" },
    ],
    value: PREV_MODE,
    onChange: () => {},
  });
  document.body.replaceChildren(root, modeSel.el);
  let live = PREV_MODE;
  const loadTsPlugin = vi.fn(async () => {
    await opts.ready.promise;
    order.push("ready");
  });
  const syncPluginSky = vi.fn(async () => {
    order.push("sky");
    if (opts.sky) await opts.sky.promise;
  });
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
    refreshPluginDrive: () => {},
    applySkyPrompt: () => {},
    reapplyCommittedModeSurfaces: () => {},
    presentDriveDeps: { sandbox: new PluginSandbox(), pluginClock: () => 0, stageAspect: () => 16 / 9 },
    computeSkyStage: () => false,
    applyStageOnly: () => {},
    applyModeFeedExtras: () => {},
    bindThisView: () => {},
    clearModeOpts: () => {},
    ensureReviewed: async () => "ok",
    loadTsPlugin,
    syncPluginSky,
    mosaic: null,
    captureMosaicSnap: () => ({ size: "4", hero: "off", tree: null, maximized: null, tiles: [] }),
    restoreMosaicSnap: () => {},
    mosaicSetSizeForMode: () => {},
    mosaicShouldResize: () => false,
    mosaicSetPaneView: () => true,
    mosaicFocusSlot: () => undefined,
    mosaicHasTile: () => false,
    applyMosaicModeVisuals: () => {},
    applySoloModeVisuals: () => {},
    syncModeHud: () => {},
    applyViewLook: (look) => {
      const spec = specs[modeSel.value] ?? null;
      if (viewLookSyncsSky(look, spec)) void syncPluginSky();
    },
    feedSetGraphBase: () => {},
    syncWifiIfNeeded: () => {},
    modeLabel: (m) => m.label,
    onConsentDeclined: () => {},
    shouldLoadPluginRuntime: () => true,
    getLastConsentedModeId: () => PREV_MODE,
    getFallbackKeptModeId: () => PREV_MODE,
    markModeConsented: (id) => setLastConsentedModeId(id),
    showRollbackMessage: () => null,
    focusModePicker: () => {},
    tileSkyStarting: opts.skyStarting,
  };
  const apply = (): void => {
    const { proceed } = beginCoordinatedModeSwitch({ channel: "user" }, PACK_MODE, {});
    const signal = beginModeSwitchAttempt();
    if (proceed) applyModeImpl(host, PACK_MODE, {}, signal);
  };
  return { host, order, loadTsPlugin, syncPluginSky, apply };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  vi.advanceTimersByTime(250);
}

describe("#226: the pick's pack sky installs after the pack's ready", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setLastConsentedModeId(PREV_MODE);
    noteConsentGranted(auroraSpec, "reviewed");
  });

  afterEach(() => {
    vi.advanceTimersByTime(6000);
    clearModeSwitchStatus();
    vi.useRealTimers();
    document.body.replaceChildren();
    resetModeSwitchStateForTests();
    resetModeSwitchAttemptForTests();
    resetPackConsentForTests();
    resetModeSwitchCoordinatorForTests();
    resetConsentStoreForTests();
    resetNeedsYouForTests();
    resetViewStatesForTests();
  });

  it("order: ready (loadTsPlugin resolved) is handled before the one sky compile", async () => {
    const ready = deferred();
    const h = harness({ ready });
    h.apply();
    await vi.waitFor(() => { expect(h.loadTsPlugin).toHaveBeenCalledTimes(1); });
    await flush();
    expect(h.order).toEqual([]);
    ready.resolve();
    await vi.waitFor(() => { expect(h.syncPluginSky).toHaveBeenCalledTimes(1); });
    await flush();
    expect(h.order).toEqual(["ready", "sky"]);
    expect(h.syncPluginSky).toHaveBeenCalledTimes(1);
  });

  it("skip: while the sky compile is pending the tile stays starting, never couldn't-start", async () => {
    const ready = deferred();
    const sky = deferred();
    const skyStarting = true;
    const h = harness({ ready, sky, skyStarting: () => skyStarting });
    h.apply();
    await vi.waitFor(() => { expect(h.loadTsPlugin).toHaveBeenCalledTimes(1); });
    ready.resolve();
    await vi.waitFor(() => { expect(h.syncPluginSky).toHaveBeenCalledTimes(1); });
    await flush();
    expect(viewStateOf("main")?.kind).toBe("starting");
    sky.resolve();
    await flush();
    expect(viewStateOf("main")?.kind).toBe("starting");
    expect(document.body.textContent ?? "").not.toContain("couldn't start");
    expect(h.order).toEqual(["ready", "sky"]);
  });
});
