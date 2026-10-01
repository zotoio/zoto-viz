/**
 * #245: on a shared context loss over a solo pack tile, render-host-tile-shader sets the tile's
 * couldn't-draw marker (the "context-lost" emit) before it asks the wall notice to show. #236's wall
 * notice inserts and then hides itself when the solo tile already says the loss, so with this order it
 * is hidden in the same call that inserts it: no visible role=alert exists at any point, not even
 * until the next microtask. The end state (the tile says it once, no wall alert) is #236's, unchanged.
 *
 * The real path, as gfx-wall-notice-surface-236 row (a): a RenderHost over a fake GL context, the lost
 * event dispatched on its canvas, bindCantDrawViewState + bindCantDrawSurface painting the tile.
 * No clocks and no fake timers: every check is either synchronous or after a few microtasks.
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindCantDrawViewState } from "../app/cant-draw-state";
import { bindCantDrawSurface } from "../app/cant-draw-surface";
import { resetViewStatesForTests, setViewState, setViewStateTileResolver, viewStateOf } from "../app/view-state";
import { RenderHost, type HostedView } from "./render-host";

const PACK_VIEW = "plugin:rocket-car-soccer";
const PACK_NAME = "Rocket Car Soccer";
const MARKER = "data-cant-draw-surface";
const WALL_NOTICE = "gfx-wall-notice";
const TILE_SURFACE = ".tile-cant-draw";

/** Let MutationObserver callbacks and other microtasks run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

/** In the accessibility tree: no `hidden` / aria-hidden on it or an ancestor, and not display:none. */
function inA11yTree(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n instanceof HTMLElement && n.hidden) return false;
    if (n.getAttribute("aria-hidden") === "true") return false;
    if (getComputedStyle(n).display === "none") return false;
  }
  return true;
}

const wallNotices = (wall: HTMLElement) => [...wall.querySelectorAll<HTMLElement>(`.${WALL_NOTICE}`)];
const shownAlerts = (wall: HTMLElement) => [...wall.querySelectorAll("[role=alert]")].filter(inA11yTree);

function box(el: HTMLElement): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 640 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 480 });
  el.getBoundingClientRect = () => new DOMRect(0, 0, 640, 480);
}

/** Every GL call the row doesn't care about is a no-op that hands back null; the context stays lost. */
function fakeGl(lost: { on: boolean }): object {
  const known: Record<string, unknown> = {
    isContextLost: () => lost.on,
    getContextAttributes: () => ({ antialias: false }),
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    getExtension: () => null,
  };
  return new Proxy(known, { get: (target, key) => (typeof key === "string" && key in target ? target[key] : () => null) });
}

type SoloPackWall = { wall: HTMLElement; tile: HTMLElement; lose: () => void; dispose: () => void };

/** A solo wall (`#scene`) showing a pack view, as main.ts builds it. */
function soloPackWall(): SoloPackWall {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const wall = document.createElement("div");
  wall.id = "wall";
  box(wall);
  document.body.appendChild(wall);
  const host = new RenderHost(wall, {});
  const lost = { on: false };
  Object.defineProperty(host, "software", { value: false });
  delete host.canvas.dataset.softgl;
  const ctx = fakeGl(lost);
  Object.assign(host.renderer, {
    getContext: () => ctx,
    forceContextLoss: () => {},
    forceContextRestore: () => {},
    render: () => {},
    compile: () => {},
  });
  box(host.canvas);
  const tile = document.createElement("div");
  tile.id = "scene";
  tile.dataset.mode = PACK_VIEW;
  box(tile);
  wall.appendChild(tile);
  const view: HostedView = {
    viewEl: tile,
    tileId: "main",
    hostFrame: () => { host.present(view, 0x000000, new THREE.Scene(), new THREE.PerspectiveCamera()); },
    hostContextLost: () => {},
    hostContextRestored: () => {},
  };
  host.add(view);
  setViewStateTileResolver((id) => (id === "main" ? tile : null));
  setViewState("main", PACK_VIEW, { kind: "ready" }, tile);
  const stopState = bindCantDrawViewState(host);
  const stopSurface = bindCantDrawSurface(
    (viewId, packId) => (viewId === PACK_VIEW ? PACK_NAME : packId),
    { isPack: (viewId) => viewId === PACK_VIEW, retry: () => host.recreateContext() },
  );
  host.advanceFrame(16);
  return {
    wall,
    tile,
    lose: () => { lost.on = true; host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); },
    dispose: () => { stopState(); stopSurface(); host.dispose(); wall.remove(); },
  };
}

describe("#245: the tile's marker is set before the wall notice is asked to show", () => {
  let real: SoloPackWall | null = null;

  beforeEach(() => {
    expect.hasAssertions();
    resetViewStatesForTests();
  });

  afterEach(() => {
    real?.dispose();
    real = null;
    resetViewStatesForTests();
    setViewStateTileResolver(null);
    vi.unstubAllGlobals();
  });

  it("solo pack tile: marked context-lost when the wall notice is appended, the notice hidden when lose() returns, end state unchanged", async () => {
    real = soloPackWall();
    const { wall, tile } = real;
    // The tile's marker at the moment each wall notice is appended to the wall.
    const markerAtAppend: (string | null)[] = [];
    const append = wall.appendChild.bind(wall);
    wall.appendChild = <T extends Node>(node: T): T => {
      if (node instanceof HTMLElement && node.classList.contains(WALL_NOTICE)) markerAtAppend.push(tile.getAttribute(MARKER));
      return append(node);
    };

    real.lose();
    // Synchronously, before any await or microtask: the notice is already hidden, no alert is visible.
    const noticesNow = wallNotices(wall);
    const hiddenNow = noticesNow.map((n) => n.hidden);
    const shownAlertsNow = shownAlerts(wall).length;

    // (1) The tile already said the loss when the wall notice went in.
    expect(markerAtAppend).toEqual(["context-lost"]);
    // (2) #236 inserts then hides; with the marker first, both happen in the same call.
    expect(noticesNow).toHaveLength(1);
    expect(hiddenNow).toEqual([true]);
    expect(shownAlertsNow).toBe(0);

    // (3) After settling: the end state #236 lands, unchanged.
    await settle();
    expect(viewStateOf("main")).toMatchObject({ kind: "cant-draw", reason: "context-lost" });
    expect(tile.getAttribute(MARKER)).toBe("context-lost");
    expect(shownAlerts(wall)).toHaveLength(0);
    expect(wall.querySelectorAll(TILE_SURFACE)).toHaveLength(1);
    expect(wallNotices(wall).every((n) => n.hidden)).toBe(true);
  });
});
