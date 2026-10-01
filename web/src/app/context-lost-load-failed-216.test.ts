/**
 * #216: a pack tile whose WebGL context is lost before its first frame, and whose pack load then
 * fails (apply-mode's showPickCouldntStart "load-failed"). The tile carries ONE message: the
 * pack's "<Pack> couldn't draw." with Retry (cant-draw-surface), never a second "couldn't start."
 * notice painted underneath it. When the context is back and drew, the failed load runs again once,
 * through the notice's own Retry (host.retryDeclinedMode): it lands ready with no notice, or, if it
 * fails again, the one "couldn't start." notice with its Retry shows (no couldn't-draw line).
 *
 * Same harness as context-lost-pack-216.test.ts: a real RenderHost over a fake GL context, the
 * lost / restored events dispatched on the canvas; the pack is rocket-car-soccer (its manifest).
 * The solo wall's tile ("main") shows the pack; showPickCouldntStart is the real one.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import type { ViewMode } from "../core/modes";
import { RenderHost, type HostedView } from "../graph/render-host";
import { PluginSandbox } from "../plugins/host";
import { pluginViewId } from "../plugins/instances";
import type { PluginView } from "../plugins/plugin";
import { Select } from "../ui/ui";
import { showPickCouldntStart, type ApplyModeHost } from "./apply-mode";
import { bindCantDrawViewState } from "./cant-draw-state";
import { bindCantDrawSurface } from "./cant-draw-surface";
import { resetViewStatesForTests, setViewState, setViewStateTileResolver, viewStateOf } from "./view-state";

const here = dirname(fileURLToPath(import.meta.url));
const MANIFEST: unknown = parseYaml(readFileSync(resolve(here, "../../../plugins/src/rocket-car-soccer/plugin.yml"), "utf8"));

function manifestField(m: unknown, key: "id" | "name"): string {
  if (m && typeof m === "object" && key in m) {
    const v: unknown = Reflect.get(m, key);
    if (typeof v === "string" && v) return v;
  }
  throw new Error(`rocket-car-soccer plugin.yml has no ${key}`);
}

const PACK_ID = manifestField(MANIFEST, "id");
const PACK_NAME = manifestField(MANIFEST, "name");
const PACK_VIEW = pluginViewId(PACK_ID);
const TILE = "main";
const DRAW = `${PACK_NAME} couldn't draw.`;
const START = `${PACK_NAME} couldn't start.`;
const SPEC: PluginView = { id: PACK_ID, name: PACK_NAME, version: 1, runtime: "typescript", capabilities: [] };
const MODE: ViewMode = { id: PACK_VIEW, pluginId: PACK_ID, label: PACK_NAME, hint: PACK_NAME, kind: "demo", legend: () => [] };

type Browser = { lost: boolean; restoreWorks: boolean };

/** Every GL call the rows don't care about is a no-op that hands back null. */
function fakeGl(b: Browser, onRestore: () => void): object {
  const ext = {
    loseContext: () => {},
    restoreContext: () => {
      if (b.lost && b.restoreWorks) setTimeout(onRestore, 0);
    },
  };
  const known: Record<string, unknown> = {
    isContextLost: () => b.lost,
    getContextAttributes: () => ({ antialias: false }),
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    getExtension: (name: string) => (name === "WEBGL_lose_context" && !b.lost ? ext : null),
  };
  return new Proxy(known, { get: (target, key) => (typeof key === "string" && key in target ? target[key] : () => null) });
}

function box(el: HTMLElement): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 640 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 480 });
  el.getBoundingClientRect = () => new DOMRect(0, 0, 640, 480);
}

/** The apply-mode host, with only what showPickCouldntStart reads doing anything. */
function applyHost(retry: (modeId: string) => void): ApplyModeHost {
  const modeSel = new Select({ caption: "view", options: [{ value: PACK_VIEW, label: PACK_NAME }], value: PACK_VIEW, onChange: () => {} });
  return {
    modeById: () => MODE,
    optsFor: () => ({}),
    getLiveMode: () => PACK_VIEW,
    setLiveMode: () => {},
    modeSel,
    touch: () => {},
    applyPluginWall: () => {},
    pluginSpecForMode: () => SPEC,
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
    loadTsPlugin: async () => {},
    syncPluginSky: async () => {},
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
    applyViewLook: () => {},
    feedSetGraphBase: () => {},
    syncWifiIfNeeded: () => {},
    modeLabel: (m) => m.label,
    onConsentDeclined: () => {},
    shouldLoadPluginRuntime: () => true,
    getLastConsentedModeId: () => PACK_VIEW,
    getFallbackKeptModeId: () => PACK_VIEW,
    markModeConsented: () => {},
    showRollbackMessage: () => null,
    retryDeclinedMode: retry,
    focusModePicker: () => {},
  };
}

type Wall = {
  host: RenderHost;
  wall: HTMLElement;
  pane: HTMLElement;
  browser: Browser;
  /** Pack loads the notice's Retry ran (main.ts: retryDeclinedMode -> applyMode). */
  retries: string[];
  load: { works: boolean };
  apply: ApplyModeHost;
  frame: () => void;
  lose: () => void;
  stop: () => void;
};

function bootWall(): Wall {
  const raf: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => raf.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const wall = document.createElement("div");
  box(wall);
  document.body.appendChild(wall);
  const host = new RenderHost(wall, {});
  const browser: Browser = { lost: false, restoreWorks: false };
  Object.defineProperty(host, "software", { value: false });
  delete host.canvas.dataset.softgl;
  const ctx = fakeGl(browser, () => {
    browser.lost = false;
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
  });
  Object.assign(host.renderer, {
    getContext: () => ctx,
    forceContextLoss: () => {},
    forceContextRestore: () => {},
    render: () => {},
    compile: () => {},
  });
  box(host.canvas);
  const pane = document.createElement("div");
  pane.className = "mosaic-pane";
  pane.dataset.mode = PACK_VIEW;
  box(pane);
  wall.appendChild(pane);
  const view: HostedView = {
    viewEl: pane,
    tileId: TILE,
    hostFrame: () => { host.present(view, 0x000000, new THREE.Scene(), new THREE.PerspectiveCamera()); },
    hostContextLost: () => {},
    hostContextRestored: () => {},
  };
  host.add(view);
  setViewStateTileResolver((id) => (id === TILE ? pane : null));
  const retries: string[] = [];
  const load = { works: true };
  // What apply-mode does for the pick: starting, then ready, or Couldn't start / load-failed.
  const apply: ApplyModeHost = applyHost((modeId) => {
    retries.push(modeId);
    setViewState(TILE, PACK_VIEW, { kind: "starting" });
    if (load.works) setViewState(TILE, PACK_VIEW, { kind: "ready" });
    else showPickCouldntStart(apply, MODE, SPEC, "load-failed", new Error("pack load failed"));
  });
  const stopState = bindCantDrawViewState(host);
  const stopSurface = bindCantDrawSurface(
    (viewId, packId) => (viewId === PACK_VIEW ? PACK_NAME : packId),
    { isPack: (viewId) => viewId === PACK_VIEW, retry: () => host.recreateContext() },
  );
  let ts = 0;
  return {
    host,
    wall,
    pane,
    browser,
    retries,
    load,
    apply,
    frame: () => { ts += 16; host.advanceFrame(ts); },
    lose: () => { browser.lost = true; host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); },
    stop: () => { stopState(); stopSurface(); },
  };
}

const notices = (w: Wall) => w.pane.querySelectorAll<HTMLElement>(".mosaic-pane-notice");
const drawLines = (w: Wall) => w.pane.querySelectorAll<HTMLElement>(".tile-cant-draw");
const buttons = (w: Wall) => w.pane.querySelectorAll<HTMLButtonElement>("button");
const text = (w: Wall) => w.pane.textContent ?? "";

/** Lost before the first frame, then the pack load fails: one message, the couldn't-draw line. */
function loseThenLoadFails(w: Wall): void {
  w.frame();
  setViewState(TILE, PACK_VIEW, { kind: "starting" });
  w.lose();
  showPickCouldntStart(w.apply, MODE, SPEC, "load-failed", new Error("pack load failed"));

  expect(viewStateOf(TILE)).toMatchObject({ kind: "cant-draw", reason: "context-lost" });
  expect(drawLines(w)).toHaveLength(1);
  expect(drawLines(w)[0]!.textContent).toContain(DRAW);
  expect(notices(w), "no couldn't-start notice under the couldn't-draw line").toHaveLength(0);
  expect(w.pane.querySelectorAll(".mosaic-pane-notice[data-view-state]")).toHaveLength(0);
  expect(text(w)).not.toContain(START);
  expect(buttons(w)).toHaveLength(1);
  expect(w.retries).toEqual([]);
}

/** The couldn't-draw Retry; the context comes back and a frame draws. */
function contextBackAndDraws(w: Wall): void {
  w.browser.restoreWorks = true;
  buttons(w)[0]!.click();
  // Retry's restore request, then the browser's restored event (each its own later task).
  vi.advanceTimersByTime(10);
  w.frame();
}

describe("#216: a pack whose load fails under a lost context says one thing, and retries once when it's back", () => {
  let w: Wall | null = null;

  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    resetViewStatesForTests();
  });

  afterEach(() => {
    w?.stop();
    w?.host.dispose();
    w?.wall.remove();
    w = null;
    resetViewStatesForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("the context comes back and draws: the load runs again once and the tile is ready, with no notice", () => {
    w = bootWall();
    loseThenLoadFails(w);
    contextBackAndDraws(w);

    expect(w.retries).toEqual([PACK_VIEW]);
    expect(viewStateOf(TILE)).toEqual({ kind: "ready" });
    expect(notices(w)).toHaveLength(0);
    expect(drawLines(w)).toHaveLength(0);
    expect(text(w)).not.toContain(START);
    expect(text(w)).not.toContain(DRAW);
    expect(buttons(w)).toHaveLength(0);
  });

  it("the retried load fails again: one couldn't-start notice with one Retry, no couldn't-draw line", () => {
    w = bootWall();
    loseThenLoadFails(w);
    w.load.works = false;
    contextBackAndDraws(w);

    expect(w.retries).toEqual([PACK_VIEW]);
    expect(viewStateOf(TILE)).toMatchObject({ kind: "couldnt-start", reason: "load-failed", packId: PACK_ID });
    expect(drawLines(w)).toHaveLength(0);
    expect(text(w)).not.toContain(DRAW);
    const shown = notices(w);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.dataset.viewState).toBe("couldnt-start");
    expect(shown[0]!.textContent).toContain(START);
    expect(buttons(w)).toHaveLength(1);
    expect(buttons(w)[0]!.textContent).toBe("Retry");
    // No loop: that Couldn't start is the answer until the user presses its Retry.
    vi.advanceTimersByTime(5_000);
    w.frame();
    expect(w.retries).toEqual([PACK_VIEW]);
  });
});
