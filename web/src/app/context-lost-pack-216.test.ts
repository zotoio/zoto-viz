/**
 * #216: Rocket Car Soccer showed a silent blank board after the WebGL context was lost. A pack
 * tile (a view with its own frontend) says the loss on the tile itself: "<Pack> couldn't draw."
 * with Retry, in place of its sky-starting card, and never the sky wait's "couldn't start".
 * Retry asks for the context back through the WEBGL_lose_context extension the host cached while
 * the context was alive (a lost context hands back no extension), never through the sky wait.
 *
 * Same harness as #179 (c): a real RenderHost over a fake GL context, the lost / restored events
 * dispatched on the canvas, and the browser gives the context back only when the row says so.
 * The pack's display name is read from its manifest. Non-pack tile "b" keeps the #179 (c)
 * contract: the loss is said once, on the wall, with no per-tile surface.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { RenderHost, type HostedView } from "../graph/render-host";
import { pluginViewId } from "../plugins/instances";
import { bindCantDrawViewState } from "./cant-draw-state";
import { bindCantDrawSurface } from "./cant-draw-surface";
import { SKY_WAIT_DEADLINE_MS, SkyWaits } from "./sky-wait";
import { resetViewStatesForTests, setViewStateTileResolver, viewStateOf } from "./view-state";

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
const NOTICE = `${PACK_NAME} couldn't draw.`;
const LOST = { kind: "cant-draw", reason: "context-lost" };

/** What the fake browser does: whether the context is lost and whether restoreContext() works. */
type Browser = { lost: boolean; restoreWorks: boolean; restoreAsks: number };

/** Every GL call the rows don't care about is a no-op that hands back null. */
function fakeGl(b: Browser, onRestore: () => void): object {
  const ext = {
    loseContext: () => {},
    restoreContext: () => {
      b.restoreAsks += 1;
      // A real browser fires webglcontextrestored in a later task, and only if it can.
      if (b.lost && b.restoreWorks) setTimeout(onRestore, 0);
    },
  };
  const known: Record<string, unknown> = {
    isContextLost: () => b.lost,
    getContextAttributes: () => ({ antialias: false }),
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    // A lost context hands back no extension at all (three would cache that null).
    getExtension: (name: string) => (name === "WEBGL_lose_context" && !b.lost ? ext : null),
  };
  return new Proxy(known, { get: (target, key) => (typeof key === "string" && key in target ? target[key] : () => null) });
}

type Wall = {
  host: RenderHost;
  wall: HTMLElement;
  panes: Map<string, HTMLElement>;
  browser: Browser;
  skyWaits: SkyWaits;
  begin: ReturnType<typeof vi.spyOn>;
  skyRetry: ReturnType<typeof vi.fn>;
  sky: { drawn: boolean };
  frame: () => void;
  lose: () => void;
  stop: () => void;
};

function box(el: HTMLElement): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 640 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 480 });
  el.getBoundingClientRect = () => new DOMRect(0, 0, 640, 480);
}

/** Tile "rcs" shows the pack (it waits on its own sky); tile "b" is a built-in view. */
function bootWall(): Wall {
  const raf: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => raf.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const wall = document.createElement("div");
  box(wall);
  document.body.appendChild(wall);
  const host = new RenderHost(wall, {});
  const browser: Browser = { lost: false, restoreWorks: false, restoreAsks: 0 };
  Object.defineProperty(host, "software", { value: false });
  delete host.canvas.dataset.softgl;
  const restore = () => {
    browser.lost = false;
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
  };
  const ctx = fakeGl(browser, restore);
  Object.assign(host.renderer, {
    getContext: () => ctx,
    forceContextLoss: () => {},
    forceContextRestore: () => {}, // three's own path: its cached extension is null on a lost context
    render: () => {},
    compile: () => {},
  });
  box(host.canvas);
  const panes = new Map<string, HTMLElement>();
  for (const id of ["rcs", "b"]) {
    const pane = document.createElement("div");
    pane.className = "mosaic-pane";
    pane.dataset.mode = id === "rcs" ? PACK_VIEW : id;
    box(pane);
    wall.appendChild(pane);
    panes.set(id, pane);
    const view: HostedView = {
      viewEl: pane,
      tileId: id,
      hostFrame: () => { host.present(view, 0x000000, new THREE.Scene(), new THREE.PerspectiveCamera()); },
      hostContextLost: () => {},
      hostContextRestored: () => {},
    };
    host.add(view);
  }
  setViewStateTileResolver((id) => panes.get(id) ?? null);
  const sky = { drawn: false };
  const skyRetry = vi.fn();
  const skyWaits = new SkyWaits({
    hostEl: (key) => panes.get(key) ?? null,
    name: () => PACK_NAME,
    viewId: () => PACK_VIEW,
    packId: () => PACK_ID,
    skyReady: () => sky.drawn,
    retry: skyRetry,
  });
  const begin = vi.spyOn(skyWaits, "begin");
  const stopState = bindCantDrawViewState(host);
  const stopSurface = bindCantDrawSurface(
    (viewId, packId) => (viewId === PACK_VIEW ? PACK_NAME : packId),
    { isPack: (viewId) => viewId === PACK_VIEW, retry: () => host.recreateContext() },
  );
  const stop = () => { stopState(); stopSurface(); };
  let ts = 0;
  return {
    host,
    wall,
    panes,
    browser,
    skyWaits,
    begin,
    skyRetry,
    sky,
    frame: () => { ts += 16; host.advanceFrame(ts); },
    lose: () => { browser.lost = true; host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); },
    stop,
  };
}

const pane = (w: Wall, id = "rcs") => w.panes.get(id)!;
/** The tile's own notices (role=status) that carry the pack's couldn't-draw sentence. */
const drawNotices = (w: Wall) => [...pane(w).querySelectorAll<HTMLElement>("[role=status]")]
  .filter((n) => (n.textContent ?? "").includes(NOTICE));
const retryButton = (w: Wall) => drawNotices(w)[0]
  ?.querySelector<HTMLButtonElement>("button") ?? null;
const startingCards = (w: Wall) => pane(w).querySelectorAll(".sky-starting-card").length;

function expectCouldntDraw(w: Wall): void {
  expect(viewStateOf("rcs")).toMatchObject(LOST);
  const notices = drawNotices(w);
  expect(notices).toHaveLength(1);
  expect(notices[0]!.textContent).toContain(NOTICE);
  expect(retryButton(w)?.textContent).toBe("Retry");
  expect(startingCards(w)).toBe(0);
  expect(pane(w).textContent ?? "").not.toContain("Starting…");
  expect(pane(w).textContent ?? "").not.toMatch(/couldn't start/i);
  // #179 (c) for the built-in tile: no per-tile surface, the wall says it once.
  expect(pane(w, "b").querySelectorAll(".tile-cant-draw")).toHaveLength(0);
  expect(drawNoticesIn(pane(w, "b"))).toHaveLength(0);
}
const drawNoticesIn = (el: HTMLElement) => [...el.querySelectorAll("[role=status]")]
  .filter((n) => /couldn't draw/.test(n.textContent ?? ""));

describe("#216: a pack tile says a lost context on the tile, with Retry, never a silent board", () => {
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
  });

  it("(a) lost before the first frame: the notice replaces the Starting card, and no couldn't start past 45 s", () => {
    w = bootWall();
    w.frame();
    w.skyWaits.begin("rcs");
    expect(startingCards(w)).toBe(1);
    expect(viewStateOf("rcs")).toEqual({ kind: "starting" });

    w.lose();
    expectCouldntDraw(w);

    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS + 15_000);
    expectCouldntDraw(w);
    expect(w.skyWaits.state("rcs")).not.toBe("failed:timeout");
    expect(pane(w).querySelector(".mosaic-pane-notice[data-view-state='couldnt-start']")).toBeNull();
    expect(w.begin).toHaveBeenCalledTimes(1);
  });

  it("(b) lost after a frame drew: the same notice replaces the board", () => {
    w = bootWall();
    w.skyWaits.begin("rcs");
    w.sky.drawn = true;
    w.frame();
    w.skyWaits.landed("rcs");
    expect(viewStateOf("rcs")).toEqual({ kind: "ready" });

    w.lose();
    expectCouldntDraw(w);
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS + 15_000);
    expectCouldntDraw(w);
  });

  it("(c) Retry whose restore fails: the same notice comes back, no Starting, no new sky wait", () => {
    w = bootWall();
    w.frame();
    w.skyWaits.begin("rcs");
    w.lose();
    expectCouldntDraw(w);
    const asked = w.browser.restoreAsks;

    retryButton(w)!.click();
    vi.advanceTimersByTime(100);
    // Retry asked the browser through the extension cached while the context was alive.
    expect(w.browser.restoreAsks).toBeGreaterThan(asked);
    w.frame();
    expectCouldntDraw(w);
    expect(w.begin).toHaveBeenCalledTimes(1);
    expect(w.skyRetry).not.toHaveBeenCalled();
  });

  it("(c) Retry whose context comes back and is lost again: the same notice, no Starting, no new sky wait", () => {
    w = bootWall();
    w.frame();
    w.skyWaits.begin("rcs");
    w.lose();
    w.browser.restoreWorks = true;

    retryButton(w)!.click();
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(0);
    expect(w.browser.lost).toBe(false);
    w.lose();
    expectCouldntDraw(w);
    w.browser.restoreWorks = false;
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS + 15_000);
    w.frame();
    expectCouldntDraw(w);
    expect(w.begin).toHaveBeenCalledTimes(1);
    expect(w.skyRetry).not.toHaveBeenCalled();
  });

  it("(d) Retry that works: the notice comes off and the tile leaves cant-draw", () => {
    w = bootWall();
    w.skyWaits.begin("rcs");
    w.sky.drawn = true;
    w.frame();
    w.skyWaits.landed("rcs");
    w.lose();
    expectCouldntDraw(w);
    w.browser.restoreWorks = true;

    retryButton(w)!.click();
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(0);
    w.frame();
    expect(drawNotices(w)).toHaveLength(0);
    expect(pane(w).querySelectorAll(".tile-cant-draw")).toHaveLength(0);
    expect(viewStateOf("rcs")).toEqual({ kind: "ready" });
    expect(w.begin).toHaveBeenCalledTimes(1);
  });

  it("(d) Retry that works before the sky ever drew: the notice comes off and the wait goes on", () => {
    w = bootWall();
    w.frame();
    w.skyWaits.begin("rcs");
    w.lose();
    w.browser.restoreWorks = true;

    retryButton(w)!.click();
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(0);
    w.frame();
    expect(drawNotices(w)).toHaveLength(0);
    expect(viewStateOf("rcs")?.kind).not.toBe("cant-draw");
    expect(viewStateOf("rcs")).toEqual({ kind: "starting" });
    expect(w.begin).toHaveBeenCalledTimes(1);
    w.sky.drawn = true;
    w.skyWaits.landed("rcs");
    expect(viewStateOf("rcs")).toEqual({ kind: "ready" });
  });
});
