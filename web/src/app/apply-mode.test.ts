import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import * as packAssetFrame from "../plugins/pack-asset-frame";
import { countPluginSandboxIframes, PluginSandbox, setPluginModuleSandboxUrlForTests } from "../plugins/host";
import { defaultVizContract } from "../plugins/viz-host";
import type { ViewMode } from "../core/modes";
import type { PluginView } from "../plugins/plugin";
import {
  ensurePackReviewedOutcome,
  resetPackConsentForTests,
  type ConsentReviewResult,
} from "./pack-consent";
import * as pluginModule from "../plugins/plugin";
import { attachPluginFrontend } from "../plugins/plugin";
import { resetNeedsYouForTests, waitForTileReview } from "./needs-you";
import { resetViewStatesForTests, viewStateOf } from "./view-state";
import {
  addModeSwitchAbortListener,
  beginModeSwitchAttempt,
  getActiveModeSwitchSignal,
  modeSwitchAbortListenerCountForTests,
  resetModeSwitchAttemptForTests,
} from "./mode-switch-attempt";
import { Select } from "../ui/ui";
import { VizHud } from "../ui/viz-hud";
import { applyModeImpl, type ApplyModeHost } from "./apply-mode";
import { bindThisView } from "./host-view-bind";
import { settingsViewDrawerRoot } from "./test/duplicate-slot-scope-note-test-dom";
import { Settings } from "../ui/settings";
import * as viewDrawer from "../ui/view-drawer-module";
import {
  isModeSwitchStatusVisible,
  clearModeSwitchStatus,
  flashModeKeptPrevious,
  flashModeLoadFailed,
  initModeSwitchStatusStrip,
  modeSwitchStatusStacksAboveModals,
} from "./mode-switch-message";
import { askUserMedia, resetMediaAsk } from "../ui/media-ask";
import {
  getLastConsentedModeId as readLastConsentedModeId,
  resetModeSwitchStateForTests,
  setLastConsentedModeId,
} from "./mode-switch-state";
import {
  beginCoordinatedModeSwitch,
  resetModeSwitchCoordinatorForTests,
} from "./mode-switch-coordinator";
import {
  getPresentDriveTileId,
  presentDrive,
  refreshPluginDriveState,
} from "./present-drive-app";
import {
  deliverPluginPresentTick,
  presentTickStats,
  resetPresentTickStatsForTests,
} from "../plugins/viz-present-tick";

const stereoSpec: PluginView = {
  id: "stereo-gram",
  name: "Stereo",
  version: 1,
  capabilities: ["viz.write"],
  viz: defaultVizContract({ presentTick: true }),
};
const thirdSpec: PluginView = {
  id: "packet-tunnel",
  name: "Tunnel",
  version: 1,
  capabilities: ["viz.write"],
  viz: defaultVizContract({ presentTick: true }),
  runtime: "typescript",
  has_frontend: true,
  hash: "tunnel-hash",
};
const rotoSpec: PluginView = {
  id: "roto-proto",
  name: "Roto",
  version: 1,
  capabilities: ["viz.write"],
  viz: defaultVizContract({ presentTick: true }),
};

function pluginSpecConsentedForCleanup(id: string): PluginView | null {
  if (id === "plugin:stereo-gram") return stereoSpec;
  if (id === "plugin:packet-tunnel") return { ...thirdSpec, consent: "reviewed" };
  if (id === "plugin:roto-proto") {
    return {
      ...rotoSpec,
      consent: "reviewed",
      runtime: "typescript",
      has_frontend: true,
      hash: "roto-hash",
    };
  }
  return null;
}

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
  } as unknown as ViewMode;
}

function sceneEl(): HTMLElement {
  return document.getElementById("scene")!;
}

function sceneNotice(): HTMLElement | null {
  return sceneEl().querySelector<HTMLElement>(":scope > .mosaic-pane-notice");
}

function hudPackLabel(): string {
  return document.querySelector(".viz-hud-pack")?.textContent?.trim() ?? "";
}

function buildHost(
  overrides: Partial<ApplyModeHost> & { ensureReviewed: ApplyModeHost["ensureReviewed"] },
): ApplyModeHost & { bindThisViewSpy: ReturnType<typeof vi.fn>; vizHud: VizHud; skyPromptPack: () => string } {
  const sandbox = new PluginSandbox();
  const presentDriveDeps = { sandbox, pluginClock: () => 0, stageAspect: () => 16 / 9 };
  refreshPluginDriveState(stereoSpec, "plugin:stereo-gram", presentDriveDeps);
  setLastConsentedModeId("plugin:stereo-gram");

  const sceneEl = document.createElement("div");
  sceneEl.id = "scene";
  let testRoot = document.getElementById("apply-mode-test-root");
  if (!testRoot) {
    testRoot = document.createElement("div");
    testRoot.id = "apply-mode-test-root";
    document.body.append(testRoot);
  }
  const modeSel = new Select({
    caption: "view",
    options: [
      { value: "plugin:stereo-gram", label: "Stereo" },
      { value: "plugin:packet-tunnel", label: "Tunnel" },
      { value: "plugin:roto-proto", label: "Roto" },
    ],
    value: "plugin:stereo-gram",
    onChange: () => {},
  });
  testRoot.replaceChildren(sceneEl, modeSel.el);
  const vizHud = new VizHud(sceneEl, () => {});
  vizHud.setActive("stereo-gram", "Stereo");

  let live = "plugin:stereo-gram";
  let skyPromptPack = "";
  const specs: Record<string, PluginView> = {
    "plugin:stereo-gram": stereoSpec,
    "plugin:packet-tunnel": thirdSpec,
    "plugin:roto-proto": rotoSpec,
  };
  const modes: Record<string, ViewMode> = {
    "plugin:stereo-gram": mode("plugin:stereo-gram", "stereo-gram", "Stereo"),
    "plugin:packet-tunnel": mode("plugin:packet-tunnel", "packet-tunnel", "Tunnel"),
    "plugin:roto-proto": mode("plugin:roto-proto", "roto-proto", "Roto"),
  };

  const bindThisView = vi.fn();
  const host: ApplyModeHost & {
    bindThisViewSpy: ReturnType<typeof vi.fn>;
    vizHud: VizHud;
    skyPromptPack: () => string;
  } = {
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
    applySkyPrompt: (m) => { skyPromptPack = m.pluginId ?? m.id; },
    reapplyCommittedModeSurfaces: (modeId) => {
      bindThisView(modeId);
      const spec = specs[modeId] ?? null;
      host.refreshPluginDrive(spec, modeId);
    },
    computeSkyStage: () => false,
    applyStageOnly: () => {},
    applyModeFeedExtras: () => {},
    bindThisView,
    clearModeOpts: () => {},
    loadTsPlugin: overrides.loadTsPlugin ?? vi.fn(async () => {}),
    syncPluginSky: overrides.syncPluginSky ?? vi.fn(async () => {}),
    mosaic: overrides.mosaic ?? null,
    captureMosaicSnap: () => ({
      size: "4",
      hero: "off",
      tree: null,
      maximized: null,
      tiles: ["topology"],
    }),
    restoreMosaicSnap: overrides.restoreMosaicSnap ?? vi.fn(),
    mosaicSetSizeForMode: overrides.mosaicSetSizeForMode ?? vi.fn(),
    mosaicShouldResize: overrides.mosaicShouldResize ?? (() => false),
    mosaicSetPaneView: overrides.mosaicSetPaneView ?? (() => true),
    mosaicFocusSlot: overrides.mosaicFocusSlot ?? (() => "topology"),
    mosaicHasTile: overrides.mosaicHasTile ?? (() => false),
    applyMosaicModeVisuals: overrides.applyMosaicModeVisuals ?? vi.fn(),
    applySoloModeVisuals: overrides.applySoloModeVisuals ?? vi.fn(),
    syncModeHud: (m, spec) => vizHud.setActive(m.pluginId ?? spec?.id ?? null, spec?.name ?? m.label),
    applyViewLook: () => {},
    feedSetGraphBase: () => {},
    syncWifiIfNeeded: () => {},
    modeLabel: (m) => m.label,
    onConsentDeclined: () => {},
    shouldLoadPluginRuntime: () => true,
    getLastConsentedModeId: () => readLastConsentedModeId(),
    getFallbackKeptModeId: () => "plugin:stereo-gram",
    markModeConsented: (id) => setLastConsentedModeId(id),
    showRollbackMessage: (kind, declined, keptModeId) => {
      const kept = modes[keptModeId]!.label;
      if (kind === "declined") return flashModeKeptPrevious(kept);
      return flashModeLoadFailed(declined.label, kept);
    },
    focusModePicker: () => { modeSel.focusWithRing(); },
    bindThisViewSpy: bindThisView,
    vizHud,
    skyPromptPack: () => skyPromptPack,
    ...overrides,
  };
  return host;
}

function deferConsentForPack(packId: string): {
  ensureReviewed: ApplyModeHost["ensureReviewed"];
  whenPending: () => Promise<void>;
  resolve: (r: ConsentReviewResult) => void;
} {
  let settleReview!: (r: ConsentReviewResult) => void;
  const ensureReviewed: ApplyModeHost["ensureReviewed"] = (spec, attemptSignal) =>
    ensurePackReviewedOutcome(spec, (signal) => {
      if (spec?.id !== packId) return Promise.resolve("ok");
      return new Promise<ConsentReviewResult>((res) => {
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort);
          res("aborted");
        };
        signal.addEventListener("abort", onAbort, { once: true });
        settleReview = (r) => {
          signal.removeEventListener("abort", onAbort);
          res(r);
        };
      });
    }, attemptSignal);
  return {
    ensureReviewed,
    whenPending: async () => {
      await vi.waitFor(() => { expect(settleReview).toBeDefined(); });
    },
    resolve: (r) => settleReview(r),
  };
}

function runApply(host: ApplyModeHost, id: string, flags: Record<string, unknown> = {}): AbortSignal {
  const { proceed } = beginCoordinatedModeSwitch({ channel: "user" }, id, flags);
  const signal = beginModeSwitchAttempt();
  if (proceed) applyModeImpl(host, id, flags, signal);
  return signal;
}

function runApplyUser(host: ApplyModeHost, id: string, flags: Record<string, unknown> = {}): AbortSignal {
  return runApply(host, id, flags);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  vi.advanceTimersByTime(250);
}

describe("applyModeImpl: the pick stays the view (Needs you / Couldn't start, no rollback)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.advanceTimersByTime(6000);
    clearModeSwitchStatus();
    vi.useRealTimers();
    document.getElementById("apply-mode-test-root")?.replaceChildren();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    resetModeSwitchStateForTests();
    resetModeSwitchAttemptForTests();
    resetPackConsentForTests();
    resetModeSwitchCoordinatorForTests();
    resetMediaAsk();
    clearModeSwitchStatus();
    resetNeedsYouForTests();
    resetViewStatesForTests();
  });

  it("Not now with no last consented view: the pick stays, on Needs you (no default kept view)", async () => {
    setLastConsentedModeId("");
    const host = buildHost({
      ensureReviewed: async (_spec, _signal) => "declined",
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(sceneEl().dataset.viewState).toBe("needs-you");
  });

  it("Not now: picker, HUD and tile keep the pick with Needs you and Review; focus returns, no Kept message", async () => {
    const host = buildHost({ ensureReviewed: async (_spec, _signal) => "declined" });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(host.bindThisViewSpy).toHaveBeenCalledWith("plugin:packet-tunnel");
    expect(host.bindThisViewSpy).not.toHaveBeenCalledWith("plugin:stereo-gram");
    expect(hudPackLabel()).toContain("Tunnel");
    expect(sceneNotice()?.textContent).toContain("Tunnel needs your OK to run.");
    expect(sceneNotice()?.querySelector("button")?.textContent).toBe("Review");
    expect(document.activeElement).toBe(host.modeSel.el.querySelector("button"));
    expect(isModeSwitchStatusVisible()).toBe(false);
    expect(document.getElementById("modeSwitchStatus")?.textContent ?? "").not.toMatch(/^Kept /);
  });

  it("the OK could not be saved: Couldn't start with Retry on the pick's tile, never the previous view", async () => {
    const host = buildHost({ ensureReviewed: async (_spec, _signal) => "failed" });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(hudPackLabel()).toContain("Tunnel");
    expect(getPresentDriveTileId()).not.toBe("stereo-gram");
    expect(viewStateOf("main")).toEqual({ kind: "couldnt-start", reason: "grant-failed", packId: "packet-tunnel" });
    expect(sceneNotice()?.textContent).toContain("Tunnel couldn't start.");
    expect(sceneNotice()?.querySelector("button")?.textContent).toBe("Retry");
    expect(document.activeElement).toBe(host.modeSel.el.querySelector("button"));
    expect(isModeSwitchStatusVisible()).toBe(false);
  });

  it("Needs you: the previous pack's present drive stops (nothing drives it under the notice)", async () => {
    const host = buildHost({ ensureReviewed: async (_spec, _signal) => "declined" });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(getPresentDriveTileId()).not.toBe("stereo-gram");
    expect(getPresentDriveTileId()).not.toBe("packet-tunnel");
  });

  it("present drive capture order: mosaic failure restores via reapply refresh (not loadTs stub)", async () => {
    const loadTs = vi.fn(async (_spec: PluginView | null, _signal: AbortSignal) => {});
    const host = buildHost({
      ensureReviewed: async (_spec, _signal) => "ok",
      loadTsPlugin: async (spec, signal) => loadTs(spec, signal),
      mosaic: {
        on: true,
        heroPos: "off",
        heroMode: "plugin:stereo-gram",
        current: "2",
        tileIds: ["topology"],
        focusedId: "topology",
        setPaneView: () => false,
        setSize: vi.fn(),
      } as unknown as ApplyModeHost["mosaic"],
      mosaicHasTile: () => false,
      mosaicSetPaneView: () => false,
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(loadTs).not.toHaveBeenCalled();
    expect(getPresentDriveTileId()).toBe("stereo-gram");
  });

  it("mosaic setPaneView failure: failure message and present drive", async () => {
    const mosaicSetSizeForMode = vi.fn();
    const restoreMosaicSnap = vi.fn();
    const host = buildHost({
      ensureReviewed: async (_spec, _signal) => "ok",
      mosaic: { on: true, heroPos: "left", heroMode: "plugin:stereo-gram", current: "2", tileIds: ["topology"], focusedId: "topology", setSize: vi.fn(), setPaneView: () => false } as unknown as ApplyModeHost["mosaic"],
      mosaicShouldResize: () => true,
      mosaicHasTile: () => false,
      mosaicSetPaneView: () => false,
      mosaicSetSizeForMode,
      restoreMosaicSnap,
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:stereo-gram");
    expect(mosaicSetSizeForMode).toHaveBeenCalled();
    expect(restoreMosaicSnap).toHaveBeenCalled();
    expect(getPresentDriveTileId()).toBe("stereo-gram");
  });

  it("Not now in mosaic: the pane keeps the pick (no revert) and shows Needs you", async () => {
    const setPaneView = vi.fn(() => true);
    const applyMosaicModeVisuals = vi.fn();
    const host = buildHost({
      ensureReviewed: async (_spec, _signal) => "declined",
      mosaic: { on: true, heroPos: "off", heroMode: "plugin:stereo-gram", current: "2", tileIds: ["topology"], focusedId: "topology", setPaneView, setSize: vi.fn() } as unknown as ApplyModeHost["mosaic"],
      mosaicHasTile: () => false,
      mosaicSetPaneView: setPaneView,
      applyMosaicModeVisuals,
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(setPaneView).toHaveBeenCalledWith("topology", "plugin:packet-tunnel");
    expect(setPaneView).not.toHaveBeenCalledWith("plugin:packet-tunnel", "topology");
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(viewStateOf("plugin:packet-tunnel")?.kind).toBe("needs-you");
    expect(document.activeElement).toBe(host.modeSel.el.querySelector("button"));
  });

  it("stale consent: B pending, switch to C, resolve B — no B load, HUD shows C", async () => {
    let resolveB!: (r: ConsentReviewResult) => void;
    const bPending = new Promise<ConsentReviewResult>((r) => { resolveB = r; });
    const loadTs = vi.fn(async (_spec: PluginView | null, _signal: AbortSignal) => {});
    const host = buildHost({
      ensureReviewed: async (spec, _signal) => {
        if (spec?.id === "roto-proto") return bPending;
        if (spec?.id === "packet-tunnel") return "ok";
        return "ok";
      },
      loadTsPlugin: async (spec, signal) => loadTs(spec, signal),
    });
    runApply(host, "plugin:roto-proto");
    runApplyUser(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    const loadsBefore = loadTs.mock.calls.length;
    resolveB("ok");
    await flushMicrotasks();
    expect(loadTs.mock.calls.some((c) => c[0]?.id === "roto-proto")).toBe(false);
    expect(loadTs.mock.calls.length).toBe(loadsBefore);
    expect(hudPackLabel()).toContain("Tunnel");
    expect(getPresentDriveTileId()).toBe("packet-tunnel");
    expect(isModeSwitchStatusVisible()).toBe(false);
  });

  it("Not now: the live mode is the pick, not the previous view", async () => {
    const host = buildHost({ ensureReviewed: async (_spec, _signal) => "declined" });
    let live = "plugin:stereo-gram";
    host.getLiveMode = () => live;
    host.setLiveMode = (id) => { live = id; };
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(live).toBe("plugin:packet-tunnel");
  });

  it("mosaic failure rollback returns before applyMosaicModeVisuals", async () => {
    const applyMosaicModeVisuals = vi.fn();
    const host = buildHost({
      ensureReviewed: async (_spec, _signal) => "ok",
      applyMosaicModeVisuals,
      mosaic: { on: true, heroPos: "off", heroMode: "plugin:stereo-gram", current: "2", tileIds: ["topology"], focusedId: "topology", setSize: vi.fn(), setPaneView: () => false } as unknown as ApplyModeHost["mosaic"],
      mosaicHasTile: () => false,
      mosaicSetPaneView: () => false,
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(applyMosaicModeVisuals).not.toHaveBeenCalled();
  });

  it("aborted consent keeps the pick on Needs you with no Kept message", async () => {
    const host = buildHost({ ensureReviewed: async (_spec, _signal) => "aborted" });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(sceneEl().dataset.viewState).toBe("needs-you");
    expect(isModeSwitchStatusVisible()).toBe(false);
  });

  it("ensureReviewed rejection: Couldn't start on the pick, no rollback", async () => {
    const host = buildHost({
      ensureReviewed: async (_spec, _signal) => { throw new Error("review dismissed"); },
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(sceneEl().dataset.viewState).toBe("couldnt-start");
    expect(sceneNotice()?.textContent).toContain("Tunnel couldn't start.");
  });

  it("dream-cycle while B consent open then accept records consent, HUD, and load", async () => {
    const consent = deferConsentForPack("packet-tunnel");
    const loadTs = vi.fn(async (_spec: PluginView | null, _signal: AbortSignal) => {});
    const syncSky = vi.fn(async () => {});
    const applySolo = vi.fn();
    const host = buildHost({
      ensureReviewed: consent.ensureReviewed,
      loadTsPlugin: async (spec, signal) => loadTs(spec, signal),
      syncPluginSky: syncSky,
      applySoloModeVisuals: applySolo,
    });
    runApply(host, "plugin:packet-tunnel");
    await consent.whenPending();
    for (let i = 0; i < 5; i++) {
      beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:topology", {});
    }
    // Before the OK the tile is the pick on the theme background (stage only), with no pack loaded.
    expect(applySolo).toHaveBeenCalledTimes(1);
    expect(applySolo.mock.calls[0]?.[0]?.id).toBe("plugin:packet-tunnel");
    expect(applySolo.mock.calls[0]?.[3]).toBe(true);
    expect(loadTs).not.toHaveBeenCalled();
    consent.resolve("ok");
    await vi.waitFor(() => {
      expect(readLastConsentedModeId()).toBe("plugin:packet-tunnel");
    });
    expect(loadTs).toHaveBeenCalled();
    expect(syncSky).toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(hudPackLabel()).toContain("Tunnel");
    expect(host.modeSel.el.querySelector("button") === document.activeElement).toBe(true);
  });

  it("dream-cycle while B waits on its OK, then Not now: stays on B with Needs you, no Kept message", async () => {
    const consent = deferConsentForPack("packet-tunnel");
    const host = buildHost({ ensureReviewed: consent.ensureReviewed });
    runApply(host, "plugin:packet-tunnel");
    await consent.whenPending();
    for (let i = 0; i < 5; i++) {
      beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:topology", {});
    }
    consent.resolve("declined");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(sceneEl().dataset.viewState).toBe("needs-you");
    expect(document.getElementById("modeSwitchStatus")?.textContent ?? "").not.toMatch(/^Kept /);
  });

  it("user switch during consent focuses picker with no status announcement", async () => {
    const consent = deferConsentForPack("packet-tunnel");
    const host = buildHost({ ensureReviewed: consent.ensureReviewed });
    runApply(host, "plugin:packet-tunnel");
    await consent.whenPending();
    runApplyUser(host, "plugin:stereo-gram");
    await flushMicrotasks();
    expect(document.activeElement).toBe(host.modeSel.el.querySelector("button"));
    expect(host.modeSel.el.classList.contains("focus-return")).toBe(true);
    expect(document.getElementById("modeSwitchStatus")?.textContent).toBe("");
  });

  it("Needs you: picker, sky prompt and HUD name the pick while its OK is pending, and after approval", async () => {
    const consent = deferConsentForPack("packet-tunnel");
    const host = buildHost({ ensureReviewed: consent.ensureReviewed });
    runApply(host, "plugin:packet-tunnel");
    await consent.whenPending();
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(host.modeSel.el.querySelector(".val .txt")?.textContent).toBe("Tunnel");
    expect(host.skyPromptPack()).toBe("packet-tunnel");
    vi.advanceTimersByTime(400); // HUD label morph
    expect(hudPackLabel()).toBe("Tunnel");
    expect(sceneEl().dataset.viewState).toBe("needs-you");
    consent.resolve("ok");
    await vi.waitFor(() => {
      expect(host.modeSel.value).toBe("plugin:packet-tunnel");
      expect(host.skyPromptPack()).toBe("packet-tunnel");
      expect(hudPackLabel()).toBe("Tunnel");
    });
  });

  it("decline does not surface mic prompt gated behind pack consent", async () => {
    resetMediaAsk();
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
    const consent = deferConsentForPack("packet-tunnel");
    const host = buildHost({ ensureReviewed: consent.ensureReviewed });
    const micPending = askUserMedia({ audio: true }, "pulse microphone");
    runApply(host, "plugin:packet-tunnel");
    await consent.whenPending();
    await Promise.resolve();
    expect(document.querySelector("[data-media-ask]")).toBeNull();
    consent.resolve("declined");
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector("[data-media-ask]")).toBeNull();
    await expect(micPending).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("commit focuses picker with visible focus ring", async () => {
    const consent = deferConsentForPack("packet-tunnel");
    const host = buildHost({ ensureReviewed: consent.ensureReviewed });
    runApply(host, "plugin:packet-tunnel");
    await consent.whenPending();
    consent.resolve("ok");
    await vi.waitFor(() => {
      expect(host.modeSel.el.classList.contains("focus-return")).toBe(true);
      expect(document.activeElement).toBe(host.modeSel.el.querySelector("button"));
    });
  });

  it("Needs you: neither the previous pack nor the pick gets present ticks while B's OK is pending", async () => {
    resetPresentTickStatsForTests();
    const consent = deferConsentForPack("packet-tunnel");
    const host = buildHost({ ensureReviewed: consent.ensureReviewed });
    runApply(host, "plugin:packet-tunnel");
    await consent.whenPending();
    const stereoBefore = presentTickStats().byTile["stereo-gram"] ?? 0;
    deliverPluginPresentTick(presentDrive, 16);
    deliverPluginPresentTick(presentDrive, 32);
    expect(presentTickStats().byTile["packet-tunnel"] ?? 0).toBe(0);
    expect(presentTickStats().byTile["stereo-gram"] ?? 0).toBe(stereoBefore);
    consent.resolve("declined");
    await flushMicrotasks();
  });

  it("user switch while B's review is open takes it down; back to B shows one Needs you, no modal", async () => {
    const host = buildHost({
      ensureReviewed: (spec, attemptSignal) =>
        ensurePackReviewedOutcome(spec, (signal) => {
          if (spec?.id !== "packet-tunnel") return Promise.resolve("ok");
          return waitForTileReview(spec, signal).then((kind) => (signal.aborted ? "aborted" : (kind ? "ok" : "declined")));
        }, attemptSignal),
    });
    runApply(host, "plugin:packet-tunnel");
    await vi.waitFor(() => {
      expect(sceneNotice()?.querySelector("button")?.textContent).toBe("Review");
    });
    sceneNotice()!.querySelector<HTMLButtonElement>("button")!.click();
    expect(sceneEl().querySelectorAll(".pack-review")).toHaveLength(1);
    runApplyUser(host, "plugin:stereo-gram");
    await flushMicrotasks();
    expect(sceneEl().querySelector(".pack-review")).toBeNull();
    expect(sceneNotice()).toBeNull();
    runApply(host, "plugin:packet-tunnel");
    await vi.waitFor(() => {
      expect(sceneEl().querySelectorAll(".mosaic-pane-notice")).toHaveLength(1);
      expect(sceneNotice()?.querySelector("button")?.textContent).toBe("Review");
    });
    expect(sceneEl().querySelector(".pack-review")).toBeNull();
    expect(document.querySelector(".modal.ask")).toBeNull();
    await flushMicrotasks();
  });

  it("abort before load skips real attachPluginFrontend", async () => {
    const consent = deferConsentForPack("packet-tunnel");
    const sandbox = new PluginSandbox();
    const loadSpy = vi.spyOn(sandbox, "loadModule");
    const host = buildHost({
      ensureReviewed: consent.ensureReviewed,
      loadTsPlugin: async (spec, signal) => {
        beginModeSwitchAttempt();
        await attachPluginFrontend(sandbox, spec, {}, signal);
      },
    });
    runApply(host, "plugin:packet-tunnel");
    await consent.whenPending();
    consent.resolve("ok");
    await flushMicrotasks();
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("loadTsPlugin failure: Couldn't start with Retry on the pick (log kept), no rollback", async () => {
    const retry = vi.fn();
    const host = buildHost({
      ensureReviewed: async (_spec, _signal) => "ok",
      loadTsPlugin: async () => { throw new Error("boom"); },
      retryDeclinedMode: retry,
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(viewStateOf("main")).toEqual({ kind: "couldnt-start", reason: "load-failed", packId: "packet-tunnel", log: "boom" });
    expect(sceneNotice()?.textContent).toContain("Tunnel couldn't start.");
    sceneNotice()!.querySelector<HTMLButtonElement>("button")!.click();
    expect(retry).toHaveBeenCalledWith("plugin:packet-tunnel");
    expect(isModeSwitchStatusVisible()).toBe(false);
  });

  it("C's OK fails while B waits: C shows Couldn't start, B's late OK never takes the wall", async () => {
    let resolveB!: (r: ConsentReviewResult) => void;
    const bPending = new Promise<ConsentReviewResult>((r) => { resolveB = r; });
    const host = buildHost({
      ensureReviewed: async (spec, _signal) => {
        if (spec?.id === "roto-proto") return bPending;
        if (spec?.id === "packet-tunnel") return "failed";
        return "ok";
      },
    });
    runApply(host, "plugin:roto-proto");
    runApplyUser(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.getLastConsentedModeId()).toBe("plugin:stereo-gram");
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(sceneEl().dataset.viewState).toBe("couldnt-start");
    expect(sceneNotice()?.textContent).toContain("Tunnel couldn't start.");
    resolveB("ok");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(sceneEl().dataset.viewId).toBe("plugin:packet-tunnel");
  });
});

describe("applyModeImpl same mode drawer (#73)", () => {
  let rebuildDrawerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rebuildDrawerSpy = vi.spyOn(viewDrawer, "rebuildViewDrawerContent");
    resetModeSwitchAttemptForTests();
    resetModeSwitchCoordinatorForTests();
    resetModeSwitchStateForTests();
    resetPackConsentForTests();
    setLastConsentedModeId("plugin:stereo-gram");
  });

  afterEach(() => {
    rebuildDrawerSpy.mockRestore();
    document.querySelectorAll(".settings-pop").forEach((el) => el.remove());
    vi.advanceTimersByTime(6000);
    clearModeSwitchStatus();
    vi.useRealTimers();
    resetModeSwitchStateForTests();
    resetModeSwitchAttemptForTests();
    resetModeSwitchCoordinatorForTests();
    resetPackConsentForTests();
  });

  function viewLayer(settings: Settings): HTMLElement {
    const el = settingsViewDrawerRoot(settings).querySelector<HTMLElement>('.plugin-layer[data-layer="view"]');
    expect(el).toBeTruthy();
    return el!;
  }

  it("reuses drawer DOM for ten same-mode applyModeImpl calls then rebuilds once on mode change", async () => {
    const settings = new Settings({ storePrefix: "zoto-apply-same-mode", onChange: () => {} });
    document.body.append(settings.el);
    const host = buildHost({ ensureReviewed: async () => "ok" });
    const origModeById = host.modeById.bind(host);
    host.modeById = (id) => {
      const m = origModeById(id);
      const cfg = m.config;
      return { ...m, config: Array.isArray(cfg) ? cfg : [] };
    };
    const pluginSpecWithConfig = (id: string) => {
      const spec = host.pluginSpecForMode(id);
      if (!spec) return null;
      const cfg = spec.config;
      return { ...spec, config: Array.isArray(cfg) ? cfg : [] };
    };
    host.bindThisView = (modeId) =>
      bindThisView(
        {
          settings,
          hostModeById: (id) => host.modeById(id),
          pluginSpecForMode: pluginSpecWithConfig,
          lookForMode: () => null,
        },
        modeId,
      );
    settings.openView("plugin:stereo-gram");
    rebuildDrawerSpy.mockClear();
    let layer0: HTMLElement | null = null;
    for (let i = 0; i < 10; i++) {
      runApply(host, "plugin:stereo-gram");
      await flushMicrotasks();
      const layer = viewLayer(settings);
      if (!layer0) layer0 = layer;
      expect(layer).toBe(layer0);
    }
    expect(rebuildDrawerSpy).toHaveBeenCalledTimes(1);
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(rebuildDrawerSpy).toHaveBeenCalledTimes(2);
    settings.el.remove();
  });
});

const SANDBOX_TEST_FRAME = "11111111-1111-4111-8111-111111111111";
const SANDBOX_TEST_TOKEN = "sess-tok-cleanup";

function armPluginSandboxPackAssets(): void {
  setPackAssetTokenForTests("_sandbox", SANDBOX_TEST_TOKEN);
  setPackAssetTokenForTests("packet-tunnel", SANDBOX_TEST_TOKEN);
  setPackAssetTokenForTests("roto-proto", SANDBOX_TEST_TOKEN);
  vi.spyOn(packAssetFrame, "openPackAssetFrame").mockResolvedValue(SANDBOX_TEST_FRAME);
}

describe("mode switch cleanup counts", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetModeSwitchAttemptForTests();
    resetModeSwitchCoordinatorForTests();
    resetModeSwitchStateForTests();
    resetPackConsentForTests();
    setLastConsentedModeId("plugin:stereo-gram");
    armPluginSandboxPackAssets();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setPackAssetTokenForTests("_sandbox", "");
    setPackAssetTokenForTests("packet-tunnel", "");
    setPackAssetTokenForTests("roto-proto", "");
    document.querySelectorAll("iframe[sandbox]").forEach((el) => el.remove());
    resetModeSwitchAttemptForTests();
    resetModeSwitchCoordinatorForTests();
    resetModeSwitchStateForTests();
    resetPackConsentForTests();
    vi.useRealTimers();
  });

  it("20 fast A,B,C switches with slow sky and real loadTs leave one sandbox iframe", async () => {
    const sandbox = new PluginSandbox();
    vi.spyOn(pluginModule, "fetchPluginSky").mockImplementation(
      (_id, _hash, signal) => new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          if (signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
          else resolve("#version 300 es\nprecision highp float;out vec4 o;uniform float uTime,uOpacity,uBright;void main(){o=vec4(0.2);}");
        }, 40);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }),
    );
    const host = buildHost({
      ensureReviewed: async (_spec, _signal) => "ok",
      pluginSpecForMode: pluginSpecConsentedForCleanup,
      loadTsPlugin: async (spec, signal) => {
        await attachPluginFrontend(sandbox, spec, {}, signal);
      },
      syncPluginSky: async (_spec, signal) => {
        await pluginModule.fetchPluginSky("packet-tunnel", "tunnel-hash", signal).catch(() => {});
      },
    });
    const modes = ["plugin:stereo-gram", "plugin:packet-tunnel", "plugin:roto-proto"];
    for (let i = 0; i < 20; i++) {
      runApplyUser(host, modes[i % 3]!);
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(5);
    }
    vi.advanceTimersByTime(200);
    await vi.waitFor(() => {
      expect(countPluginSandboxIframes()).toBeLessThanOrEqual(1);
    });
    runApplyUser(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    vi.advanceTimersByTime(500);
    await vi.waitFor(() => {
      expect(countPluginSandboxIframes()).toBe(1);
    }, { timeout: 3000 });
  });

  it("committed attempt detaches abort listeners so switching to C disposes B once", async () => {
    const skyDisposals: Record<string, number> = {};
    let liveSkyPack: string | null = null;
    // Node can't import http pack-asset URLs; hand the frame a data: module so it really reaches ready.
    setPluginModuleSandboxUrlForTests(async () => "data:text/javascript,export%20%7B%7D");
    onTestFinished(() => setPluginModuleSandboxUrlForTests(null));
    const sandbox = new PluginSandbox();
    const unloadSpy = vi.spyOn(PluginSandbox.prototype, "unload");
    vi.spyOn(pluginModule, "fetchPluginSky").mockResolvedValue(
      "#version 300 es\nprecision highp float;out vec4 o;uniform float uTime,uOpacity,uBright;void main(){o=vec4(0.2);}",
    );
    const host = buildHost({
      ensureReviewed: async () => "ok",
      pluginSpecForMode: pluginSpecConsentedForCleanup,
      loadTsPlugin: async (spec, signal) => {
        await attachPluginFrontend(sandbox, spec, {}, signal);
      },
      syncPluginSky: async (spec, signal) => {
        if (liveSkyPack && liveSkyPack !== spec?.id) {
          skyDisposals[liveSkyPack] = (skyDisposals[liveSkyPack] ?? 0) + 1;
          liveSkyPack = null;
        }
        if (!spec) return;
        const packId = spec.id;
        const disposeSky = () => {
          skyDisposals[packId] = (skyDisposals[packId] ?? 0) + 1;
          if (liveSkyPack === packId) liveSkyPack = null;
        };
        addModeSwitchAbortListener(signal, disposeSky, { once: true });
        liveSkyPack = packId;
      },
    });
    runApplyUser(host, "plugin:stereo-gram");
    await flushMicrotasks();
    expect(host.pluginSpecForMode("plugin:packet-tunnel")?.consent).toBe("reviewed");
    const bSignal = runApplyUser(host, "plugin:packet-tunnel");
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    await vi.waitFor(() => {
      expect(getActiveModeSwitchSignal()).toBeUndefined();
      expect(modeSwitchAbortListenerCountForTests(bSignal)).toBe(0);
    });
    const unloadsAfterB = unloadSpy.mock.calls.length;
    expect(skyDisposals["packet-tunnel"] ?? 0).toBe(0);
    runApplyUser(host, "plugin:roto-proto");
    await vi.waitFor(() => {
      expect(unloadSpy.mock.calls.length - unloadsAfterB).toBe(1);
      expect(skyDisposals["packet-tunnel"]).toBe(1);
    });
  });
});

describe("applyMode via main host", { timeout: 30_000 }, () => {
  function mountShell(): void {
    document.body.innerHTML = `
      <div id="wall"><div id="scene"></div>
        <div id="pong" class="arcade" hidden></div><div id="invaders" class="arcade" hidden></div>
        <div id="command" class="arcade" hidden></div><div id="frogger" class="arcade" hidden></div>
        <div id="cpupong" class="arcade" hidden></div><div id="doom" class="arcade" hidden></div>
        <div id="waves" class="arcade" hidden></div><div id="orbits" class="arcade" hidden></div>
        <div id="helix" class="arcade" hidden></div><div id="skyline" class="arcade" hidden></div>
        <div id="pacman" class="arcade" hidden></div><div id="tetris" class="arcade" hidden></div>
        <div id="portal" class="arcade" hidden></div><div id="carousel" class="arcade" hidden></div>
      </div>
      <header id="bar">
        <div class="row top">
          <span id="conn" class="dot"></span><strong class="brand">zoto-viz</strong><span id="net"></span>
          <span id="pps">0</span><span id="bps">0</span>
          <span id="lanDevs">0</span><span id="lanOnline">0</span>
          <span id="netSvcs">0</span><span id="netOnline">0</span>
          <span id="flows">0</span><span id="active">0</span>
        </div>
        <div class="row controls">
          <span id="modeBox"></span><span id="modeOpts"></span>
          <span id="dreamBox"></span><span id="feedBox"></span><span id="chatBox"></span>
          <span id="debugBox"></span><span id="labelsBox"></span><span id="overlaysBox"></span>
          <span id="cameraBox"></span><span id="micBox"></span><span id="soundBox"></span>
          <span id="diceBox"></span><span id="aiBox"></span><div id="quick" hidden></div>
          <span id="settingsBox"></span>
        </div>
      </header>
      <aside id="panel" hidden></aside>
      <div id="livefeed" hidden></div><div id="livechat" hidden></div>
      <aside id="debuglog" hidden></aside>
      <div id="foot"><div id="hint"></div><div id="legend"></div></div>
    `;
  }

  beforeEach(() => {
    vi.useRealTimers();
    mountShell();
    initModeSwitchStatusStrip();
    vi.stubGlobal("WebSocket", class { close() {} });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "zoto-viz.mode" ? "topology" : null),
      setItem: () => {},
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ plugins: [] }),
    })));
  });

  afterEach(async () => {
    const { resetApplyModeTestOverrides } = await import("./apply-mode-test-host");
    resetApplyModeTestOverrides();
    clearModeSwitchStatus();
    resetModeSwitchStateForTests();
    vi.unstubAllGlobals();
  });

  it("Not now via the main host: Needs you on the tile, no Kept status, #hint not morphing", async () => {
    const { applyMode } = await import("./main");
    const { configureApplyModeForTests } = await import("./apply-mode-test-host");
    const reviewSpec: PluginView = {
      id: "stereo-gram",
      name: "Stereo",
      version: 1,
      engine: "graph",
      base: "topology",
      capabilities: ["viz.write"],
      runtime: "typescript",
      has_frontend: true,
      hash: "stereo-hash",
      viz: defaultVizContract({ presentTick: true }),
    };
    configureApplyModeForTests({
      review: async () => null,
      liveMode: "topology",
      lastConsentedMode: "topology",
      pluginSpecs: [reviewSpec],
    });
    setLastConsentedModeId("topology");
    applyMode("plugin:stereo-gram");
    await vi.waitFor(() => {
      expect(document.getElementById("scene")?.dataset.viewState).toBe("needs-you");
    });
    expect(document.getElementById("scene")?.dataset.viewId).toBe("plugin:stereo-gram");
    expect(isModeSwitchStatusVisible()).toBe(false);
    const status = document.getElementById("modeSwitchStatus");
    expect(status?.classList.contains("morphing")).not.toBe(true);
    expect(document.querySelector(".modal.ask")).toBeNull();
  });

  it("a review that throws via the main host: Couldn't start with Retry, no rollback", async () => {
    const { applyMode } = await import("./main");
    const { configureApplyModeForTests } = await import("./apply-mode-test-host");
    const reviewSpec: PluginView = {
      id: "stereo-gram",
      name: "Stereo",
      version: 1,
      engine: "graph",
      base: "topology",
      capabilities: ["viz.write"],
      runtime: "typescript",
      has_frontend: true,
      hash: "stereo-hash",
      viz: defaultVizContract({ presentTick: true }),
    };
    configureApplyModeForTests({
      review: async () => { throw new Error("review dismissed"); },
      liveMode: "topology",
      lastConsentedMode: "topology",
      pluginSpecs: [reviewSpec],
    });
    setLastConsentedModeId("topology");
    applyMode("plugin:stereo-gram");
    await vi.waitFor(() => {
      expect(document.getElementById("scene")?.dataset.viewState).toBe("couldnt-start");
    });
    expect(document.querySelector("#scene > .mosaic-pane-notice")?.textContent).toContain("Stereo couldn't start.");
    expect(document.getElementById("modeSwitchStatus")?.textContent ?? "").not.toContain("Couldn't load");
  });
});

describe("wall view opens its wall (Syscon / Cypher CIC, #172)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.advanceTimersByTime(6000);
    vi.useRealTimers();
    document.getElementById("apply-mode-test-root")?.replaceChildren();
    resetModeSwitchStateForTests();
    resetModeSwitchAttemptForTests();
    resetPackConsentForTests();
    resetModeSwitchCoordinatorForTests();
    clearModeSwitchStatus();
  });

  it.each([
    { name: "Syscon", id: "syscon", hero: "off" as const, tiles: ["plugin:cores", "plugin:memory"] },
    { name: "Cypher CIC", id: "cypher-cic", hero: "center" as const, tiles: ["plugin:topology", "plugin:talkers", "plugin:protocols"] },
  ])("$name: applyModeImpl does not swap the wall view into its own wall's focus tile", async (w) => {
    const wallId = `plugin:${w.id}`;
    const wallSpec: PluginView = {
      id: w.id, name: w.name, version: 1, capabilities: ["viz.write"], consent: "authored",
      look: { mosaic: "8", hero: w.hero, mosaicTiles: w.tiles },
    };
    const focus = w.tiles[w.hero === "off" ? 0 : 1]!;
    const setPaneView = vi.fn(() => true);
    const applyMosaicModeVisuals = vi.fn();
    const host = buildHost({
      ensureReviewed: async () => "ok",
      // applyPluginWall has just laid the wall out (mosaic on, the wall's own tiles on screen).
      mosaic: { on: true, heroPos: w.hero, heroMode: "", current: "8", tileIds: w.tiles, focusedId: focus, setPaneView, setSize: vi.fn() } as unknown as ApplyModeHost["mosaic"],
      modeById: (id) => mode(id, id.replace("plugin:", ""), id === wallId ? w.name : id),
      pluginSpecForMode: (id) => (id === wallId ? wallSpec : null),
      mosaicHasTile: (id) => w.tiles.includes(id),
      mosaicFocusSlot: () => focus,
      mosaicSetPaneView: setPaneView,
      applyMosaicModeVisuals,
    });
    runApply(host, wallId);
    await flushMicrotasks();
    expect(setPaneView, `setPaneView calls: ${JSON.stringify(setPaneView.mock.calls)}`).not.toHaveBeenCalled();
    expect(host.getLiveMode()).toBe(wallId);
    expect(applyMosaicModeVisuals).toHaveBeenCalledWith(expect.objectContaining({ id: wallId }), {}, wallSpec, false);
  });
});
