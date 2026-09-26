import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginSandbox } from "../plugins/host";
import { defaultVizContract } from "../plugins/viz-host";
import type { ViewMode } from "../core/modes";
import type { PluginView } from "../plugins/plugin";
import {
  abortAllOpenPackConsents,
  ensurePackReviewedOutcome,
  resetPackConsentForTests,
  type ConsentReviewResult,
} from "./pack-consent";
import { attachPluginFrontend } from "../plugins/plugin";
import { askPluginReview } from "../plugins/plugin-ui";
import { Select } from "../ui/ui";
import { VizHud } from "../ui/viz-hud";
import { applyModeImpl, type ApplyModeHost } from "./apply-mode";
import {
  isModeSwitchStatusVisible,
  clearModeSwitchStatus,
  flashModeKeptPrevious,
  flashModeLoadFailed,
  initModeSwitchStatusStrip,
} from "./mode-switch-message";
import {
  bumpModeSwitchGeneration,
  getLastConsentedModeId as readLastConsentedModeId,
  isModeSwitchStale,
  resetModeSwitchStateForTests,
  setLastConsentedModeId,
} from "./mode-switch-state";
import {
  beginCoordinatedModeSwitch,
  resetModeSwitchCoordinatorForTests,
} from "./mode-switch-coordinator";
import { getPresentDriveTileId, refreshPluginDriveState } from "./present-drive-app";

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

function hudPackLabel(): string {
  return document.querySelector(".viz-hud-pack")?.textContent?.trim() ?? "";
}

function buildHost(
  overrides: Partial<ApplyModeHost> & { ensureReviewed: ApplyModeHost["ensureReviewed"] },
): ApplyModeHost & { bindThisViewSpy: ReturnType<typeof vi.fn>; vizHud: VizHud } {
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
  const rotoSpec: PluginView = {
    id: "roto-proto",
    name: "Roto",
    version: 1,
    capabilities: ["viz.write"],
    viz: defaultVizContract({ presentTick: true }),
  };
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
  const host: ApplyModeHost & { bindThisViewSpy: ReturnType<typeof vi.fn>; vizHud: VizHud } = {
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
      const spec = specs[modeId] ?? null;
      host.refreshPluginDrive(spec, modeId);
    },
    computeSkyStage: () => false,
    applyStageOnly: () => {},
    applyModeFeedExtras: () => {},
    bindThisView,
    clearModeOpts: () => {},
    ensureReviewed: overrides.ensureReviewed,
    loadTsPlugin: overrides.loadTsPlugin ?? vi.fn(async () => {}),
    syncPluginSky: overrides.syncPluginSky ?? vi.fn(async () => {}),
    mosaic: overrides.mosaic ?? null,
    captureMosaicSnap: () => ({
      size: "2",
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
    isModeSwitchStale: (gen) => isModeSwitchStale(gen),
    getLastConsentedModeId: () => readLastConsentedModeId(),
    getFallbackKeptModeId: () => "plugin:stereo-gram",
    markModeConsented: (id) => setLastConsentedModeId(id),
    showRollbackMessage: (kind, declined, keptModeId) => {
      const kept = modes[keptModeId]!.label;
      if (kind === "declined") return flashModeKeptPrevious(kept);
      return flashModeLoadFailed(declined.label, kept);
    },
    bindThisViewSpy: bindThisView,
    vizHud,
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
  const ensureReviewed: ApplyModeHost["ensureReviewed"] = (spec) =>
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
    });
  return {
    ensureReviewed,
    whenPending: async () => {
      await vi.waitFor(() => { expect(settleReview).toBeDefined(); });
    },
    resolve: (r) => settleReview(r),
  };
}

function runApply(host: ApplyModeHost, id: string, flags: Record<string, unknown> = {}): number {
  const { switchGen, proceed } = beginCoordinatedModeSwitch({ channel: "user" }, id, flags);
  if (proceed) applyModeImpl(host, id, flags, switchGen);
  return switchGen;
}

function runApplyUser(host: ApplyModeHost, id: string, flags: Record<string, unknown> = {}): number {
  abortAllOpenPackConsents();
  return runApply(host, id, flags);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  vi.advanceTimersByTime(250);
}

describe("applyModeImpl rollback", () => {
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
    resetPackConsentForTests();
    resetModeSwitchCoordinatorForTests();
    clearModeSwitchStatus();
  });

  it("decline with empty last consented falls back to default kept mode", async () => {
    setLastConsentedModeId("");
    const host = buildHost({
      ensureReviewed: async () => "declined",
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:stereo-gram");
  });

  it("decline: restores picker, HUD, focus, Kept message, present drive (not failure wording)", async () => {
    const host = buildHost({ ensureReviewed: async () => "declined" });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:stereo-gram");
    expect(host.bindThisViewSpy).toHaveBeenCalledWith("plugin:stereo-gram");
    expect(hudPackLabel()).toContain("Stereo");
    expect(getPresentDriveTileId()).toBe("stereo-gram");
    expect(document.activeElement).toBe(host.modeSel.el.querySelector("button"));
    expect(isModeSwitchStatusVisible()).toBe(true);
    expect(document.getElementById("modeSwitchStatus")?.textContent).toMatch(/^Kept /);
  });

  it("failure: shows Couldn't load, visible status strip, HUD and focus", async () => {
    const host = buildHost({ ensureReviewed: async () => "failed" });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:stereo-gram");
    expect(hudPackLabel()).toContain("Stereo");
    expect(getPresentDriveTileId()).toBe("stereo-gram");
    expect(document.activeElement).toBe(host.modeSel.el.querySelector("button"));
    expect(isModeSwitchStatusVisible()).toBe(true);
    expect(document.getElementById("modeSwitchStatus")?.textContent).toContain("Couldn't load Tunnel");
  });

  it("presentDrive stays on previous pack after rollback (reapply refreshes drive)", async () => {
    const host = buildHost({ ensureReviewed: async () => "declined" });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(getPresentDriveTileId()).toBe("stereo-gram");
    expect(getPresentDriveTileId()).not.toBe("packet-tunnel");
  });

  it("present drive capture order: mosaic failure restores via reapply refresh (not loadTs stub)", async () => {
    const loadTs = vi.fn(async () => {});
    const host = buildHost({
      ensureReviewed: async () => "ok",
      loadTsPlugin: loadTs,
      mosaic: {
        on: true,
        heroPos: "off",
        heroMode: "plugin:stereo-gram",
        current: "2",
        tileIds: ["topology"],
        focusedId: "topology",
        setPaneView: () => false,
        setSize: vi.fn(),
      } as ApplyModeHost["mosaic"],
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
      ensureReviewed: async () => "ok",
      mosaic: { on: true, heroPos: "left", heroMode: "plugin:stereo-gram", current: "2", tileIds: ["topology"], focusedId: "topology", setSize: vi.fn(), setPaneView: () => false } as ApplyModeHost["mosaic"],
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

  it("decline in mosaic reverts setPaneView before visuals stick", async () => {
    const setPaneView = vi.fn(() => true);
    const applyMosaicModeVisuals = vi.fn();
    const host = buildHost({
      ensureReviewed: async () => "declined",
      mosaic: { on: true, heroPos: "off", heroMode: "plugin:stereo-gram", current: "2", tileIds: ["topology"], focusedId: "topology", setPaneView, setSize: vi.fn() } as ApplyModeHost["mosaic"],
      mosaicHasTile: () => false,
      mosaicSetPaneView: setPaneView,
      applyMosaicModeVisuals,
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(setPaneView).toHaveBeenCalledWith("topology", "plugin:packet-tunnel");
    expect(setPaneView).toHaveBeenCalledWith("plugin:packet-tunnel", "topology");
    expect(host.modeSel.value).toBe("plugin:stereo-gram");
    expect(document.activeElement).toBe(host.modeSel.el.querySelector("button"));
  });

  it("stale consent: B pending, switch to C, resolve B — no B load, HUD shows C", async () => {
    let resolveB!: (r: ConsentReviewResult) => void;
    const bPending = new Promise<ConsentReviewResult>((r) => { resolveB = r; });
    const loadTs = vi.fn(async () => {});
    const host = buildHost({
      ensureReviewed: async (spec) => {
        if (spec?.id === "roto-proto") return bPending;
        if (spec?.id === "packet-tunnel") return "ok";
        return "ok";
      },
      loadTsPlugin: loadTs,
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

  it("rollback restores getLiveMode to kept mode", async () => {
    const host = buildHost({ ensureReviewed: async () => "declined" });
    let live = "plugin:stereo-gram";
    host.getLiveMode = () => live;
    host.setLiveMode = (id) => { live = id; };
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(live).toBe("plugin:stereo-gram");
  });

  it("mosaic failure rollback returns before applyMosaicModeVisuals", async () => {
    const applyMosaicModeVisuals = vi.fn();
    const host = buildHost({
      ensureReviewed: async () => "ok",
      applyMosaicModeVisuals,
      mosaic: { on: true, heroPos: "off", heroMode: "plugin:stereo-gram", current: "2", tileIds: ["topology"], focusedId: "topology", setSize: vi.fn(), setPaneView: () => false } as ApplyModeHost["mosaic"],
      mosaicHasTile: () => false,
      mosaicSetPaneView: () => false,
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(applyMosaicModeVisuals).not.toHaveBeenCalled();
  });

  it("aborted consent does not rollback or show Kept message", async () => {
    const host = buildHost({ ensureReviewed: async () => "aborted" });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:packet-tunnel");
    expect(isModeSwitchStatusVisible()).toBe(false);
  });

  it("ensureReviewed rejection rolls back with failure path", async () => {
    const host = buildHost({
      ensureReviewed: async () => { throw new Error("dialog dismissed"); },
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:stereo-gram");
    expect(document.getElementById("modeSwitchStatus")?.textContent).toContain("Couldn't load");
  });

  it("dream-cycle while B consent open then accept records consent, HUD, and load", async () => {
    const consent = deferConsentForPack("packet-tunnel");
    const loadTs = vi.fn(async () => {});
    const syncSky = vi.fn(async () => {});
    const applySolo = vi.fn();
    const host = buildHost({
      ensureReviewed: consent.ensureReviewed,
      loadTsPlugin: loadTs,
      syncPluginSky: syncSky,
      applySoloModeVisuals: applySolo,
    });
    runApply(host, "plugin:packet-tunnel");
    await consent.whenPending();
    for (let i = 0; i < 5; i++) {
      beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:topology", {});
    }
    expect(applySolo).not.toHaveBeenCalled();
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

  it("dream-cycle while B consent open then decline rolls back with Kept message", async () => {
    const consent = deferConsentForPack("packet-tunnel");
    const host = buildHost({ ensureReviewed: consent.ensureReviewed });
    runApply(host, "plugin:packet-tunnel");
    await consent.whenPending();
    for (let i = 0; i < 5; i++) {
      beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:topology", {});
    }
    consent.resolve("declined");
    await vi.waitFor(() => {
      expect(host.modeSel.value).toBe("plugin:stereo-gram");
      expect(document.getElementById("modeSwitchStatus")?.textContent).toMatch(/^Kept /);
    });
  });

  it("user switch while B consent open closes dialog; return to B shows one dialog", async () => {
    const host = buildHost({
      ensureReviewed: (spec) =>
        ensurePackReviewedOutcome(spec, (signal) => {
          if (spec?.id !== "packet-tunnel") return Promise.resolve("ok");
          return askPluginReview(spec, { signal }).then((kind) => (kind ? "ok" : "declined"));
        }),
    });
    runApply(host, "plugin:packet-tunnel");
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".modal.ask")).toHaveLength(1);
    });
    runApplyUser(host, "plugin:stereo-gram");
    await flushMicrotasks();
    expect(document.querySelector(".modal.ask")).toBeNull();
    runApply(host, "plugin:packet-tunnel");
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".modal.ask")).toHaveLength(1);
    });
    abortAllOpenPackConsents();
    await flushMicrotasks();
  });

  it("stale load: real attachPluginFrontend skips when generation advances before load", async () => {
    const consent = deferConsentForPack("packet-tunnel");
    const sandbox = new PluginSandbox();
    const loadSpy = vi.spyOn(sandbox, "loadModule");
    const host = buildHost({
      ensureReviewed: consent.ensureReviewed,
      loadTsPlugin: async (spec, switchGen) => {
        bumpModeSwitchGeneration();
        await attachPluginFrontend(sandbox, spec, {}, switchGen, isModeSwitchStale);
      },
    });
    runApply(host, "plugin:packet-tunnel");
    await consent.whenPending();
    consent.resolve("ok");
    await flushMicrotasks();
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("loadTsPlugin failure rolls back with Couldn't load message", async () => {
    const host = buildHost({
      ensureReviewed: async () => "ok",
      loadTsPlugin: async () => { throw new Error("boom"); },
    });
    runApply(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:stereo-gram");
    expect(document.getElementById("modeSwitchStatus")?.textContent).toContain("Couldn't load Tunnel");
  });

  it("C fails while B consent pending: message names last consented A not B", async () => {
    let resolveB!: (r: ConsentReviewResult) => void;
    const bPending = new Promise<ConsentReviewResult>((r) => { resolveB = r; });
    const host = buildHost({
      ensureReviewed: async (spec) => {
        if (spec?.id === "roto-proto") return bPending;
        if (spec?.id === "packet-tunnel") return "failed";
        return "ok";
      },
    });
    runApply(host, "plugin:roto-proto");
    runApplyUser(host, "plugin:packet-tunnel");
    await flushMicrotasks();
    expect(host.getLastConsentedModeId()).toBe("plugin:stereo-gram");
    expect(document.getElementById("modeSwitchStatus")?.textContent).toContain("kept Stereo");
    expect(document.getElementById("modeSwitchStatus")?.textContent).not.toContain("Roto");
    resolveB("ok");
    await flushMicrotasks();
    expect(host.modeSel.value).toBe("plugin:stereo-gram");
  });
});

describe("applyMode via main host", () => {
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
          <span id="debugBox"></span><span id="labelsBox"></span>
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

  it("uses dedicated status element (not stuck #hint morphing) on consent decline", async () => {
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
      askPluginReview: async () => null,
      liveMode: "topology",
      lastConsentedMode: "topology",
      pluginSpecs: [reviewSpec],
    });
    setLastConsentedModeId("topology");
    applyMode("plugin:stereo-gram");
    await vi.waitFor(() => {
      expect(document.getElementById("modeSwitchStatus")?.textContent).toMatch(/^Kept /);
      expect(isModeSwitchStatusVisible()).toBe(true);
    });
    const status = document.getElementById("modeSwitchStatus");
    expect(status?.classList.contains("morphing")).not.toBe(true);
  });

  it("askPluginReview rejection rolls back with failure message", async () => {
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
      askPluginReview: async () => { throw new Error("dialog dismissed"); },
      liveMode: "topology",
      lastConsentedMode: "topology",
      pluginSpecs: [reviewSpec],
    });
    setLastConsentedModeId("topology");
    applyMode("plugin:stereo-gram");
    await vi.waitFor(() => {
      expect(document.getElementById("modeSwitchStatus")?.textContent).toContain("Couldn't load");
    });
  });
});
