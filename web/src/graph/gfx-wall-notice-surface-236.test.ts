/**
 * #236 (second half): a solo pack tile that says a lost context itself (#216: its own "couldn't
 * draw" line with Retry, marked `data-cant-draw-surface="context-lost"` by cant-draw-surface) gets
 * no second notice from the wall. The wall notice is `hidden` (out of the accessibility tree), so the
 * loss is announced once, by the tile. It follows the marker while the notice is up: cleared (the
 * pane switched to a non-pack view) brings the wall notice back, set again hides it. A non-pack tile,
 * a "shader" marker and a mixed mosaic keep the wall notice as before.
 *
 * Rows (a) and (d) run the real path: a RenderHost over a fake GL context, the lost event dispatched
 * on its canvas, bindCantDrawViewState + bindCantDrawSurface painting the tiles (as main.ts does).
 * Rows (b) and (c) drive the marker directly on a GfxWallNotice, the way cant-draw-surface sets it.
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindCantDrawViewState } from "../app/cant-draw-state";
import { bindCantDrawSurface } from "../app/cant-draw-surface";
import { resetViewStatesForTests, setViewState, setViewStateTileResolver, viewStateOf } from "../app/view-state";
import { GfxWallNotice } from "./gfx-wall-notice";
import { RenderHost, type HostedView } from "./render-host";
import { GFX_INTERRUPTED_NOTICE, GFX_NO_RESTORE_NOTICE } from "./shader-fallback-copy";

const PACK_VIEW = "plugin:rocket-car-soccer";
const PACK_NAME = "Rocket Car Soccer";
const TILE_LINE = `${PACK_NAME} couldn't draw.`;
const MARKER = "data-cant-draw-surface";

/** Let MutationObserver callbacks run (they are delivered as microtasks). */
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

/** Exactly the selectors QE and UX Pro check: a wall notice that is not hidden, and a tile's own surface. */
const SHOWN_WALL_NOTICE = ".gfx-wall-notice:not([hidden])";
const TILE_SURFACE = ".tile-cant-draw";
const wallNotices = (wall: HTMLElement) => [...wall.querySelectorAll<HTMLElement>(".gfx-wall-notice")];
const shownWallNotices = (wall: HTMLElement) => [...wall.querySelectorAll<HTMLElement>(SHOWN_WALL_NOTICE)];
const shownAlerts = (wall: HTMLElement) => [...wall.querySelectorAll("[role=alert]")].filter(inA11yTree);
/** The tile's own notices (role=status) that carry the pack's couldn't-draw sentence. */
const tileNotices = (tile: HTMLElement) => [...tile.querySelectorAll("[role=status]")]
  .filter((n) => (n.textContent ?? "").includes(TILE_LINE));

function box(el: HTMLElement): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 640 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 480 });
  el.getBoundingClientRect = () => new DOMRect(0, 0, 640, 480);
}

/** Every GL call the rows don't care about is a no-op that hands back null; the context stays lost. */
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

type RealWall = { wall: HTMLElement; tiles: Map<string, HTMLElement>; lose: () => void; dispose: () => void };

/**
 * A wall as main.ts builds it. `tiles` maps tile id to its view: one entry "main" is the solo wall
 * (`#scene`), more entries are mosaic panes. A view is a pack when it is PACK_VIEW.
 */
function realWall(tiles: Record<string, string>): RealWall {
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
  const els = new Map<string, HTMLElement>();
  const viewOf = new Map(Object.entries(tiles));
  for (const [id, viewId] of viewOf) {
    const el = document.createElement("div");
    if (id === "main") el.id = "scene";
    else el.className = "mosaic-pane";
    el.dataset.mode = viewId;
    box(el);
    wall.appendChild(el);
    els.set(id, el);
    const view: HostedView = {
      viewEl: el,
      tileId: id,
      hostFrame: () => { host.present(view, 0x000000, new THREE.Scene(), new THREE.PerspectiveCamera()); },
      hostContextLost: () => {},
      hostContextRestored: () => {},
    };
    host.add(view);
  }
  setViewStateTileResolver((id) => els.get(id) ?? null);
  // Each tile is showing its view (the pack's sky landed), as before any loss.
  for (const [id, viewId] of viewOf) setViewState(id, viewId, { kind: "ready" }, els.get(id));
  const stopState = bindCantDrawViewState(host);
  const stopSurface = bindCantDrawSurface(
    (viewId, packId) => (viewId === PACK_VIEW ? PACK_NAME : packId),
    { isPack: (viewId) => viewId === PACK_VIEW, retry: () => host.recreateContext() },
  );
  let ts = 0;
  host.advanceFrame((ts += 16));
  return {
    wall,
    tiles: els,
    lose: () => { lost.on = true; host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); },
    dispose: () => { stopState(); stopSurface(); host.dispose(); wall.remove(); },
  };
}

/**
 * Watches the wall with a MutationObserver. `leftShowing` gets every wall notice that is still
 * `.gfx-wall-notice:not([hidden])` once a burst of DOM changes has settled (checked after every
 * observer of that burst has run), so a notice the wall hides in the same burst it appears in does
 * not count, and one that stays or comes back does.
 */
function recordWallNotices(wall: HTMLElement) {
  const inserted: HTMLElement[] = [];
  const leftShowing = new Set<HTMLElement>();
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) if (n instanceof HTMLElement && n.classList.contains("gfx-wall-notice")) inserted.push(n);
    }
    queueMicrotask(() => { for (const n of shownWallNotices(wall)) leftShowing.add(n); });
  });
  obs.observe(wall, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", MARKER] });
  return { inserted, leftShowing, stop: () => obs.disconnect() };
}

/** A bare wall with a solo scene, for rows that drive the marker the way cant-draw-surface sets it. */
function soloWall(): { wall: HTMLElement; scene: HTMLElement; mark: (reason: string | null) => void } {
  const wall = document.createElement("div");
  const scene = document.createElement("div");
  scene.id = "scene";
  wall.appendChild(scene);
  document.body.appendChild(wall);
  const mark = (reason: string | null) => {
    scene.querySelector(TILE_SURFACE)?.remove();
    if (reason === null) {
      scene.removeAttribute(MARKER);
      return;
    }
    const surface = document.createElement("div");
    surface.className = TILE_SURFACE.slice(1);
    surface.setAttribute("role", "status");
    surface.dataset.reason = reason;
    scene.appendChild(surface);
    scene.setAttribute(MARKER, reason);
  };
  return { wall, scene, mark };
}

describe("#236: the wall notice is not a second notice over a pack tile that says the loss itself", () => {
  let real: RealWall | null = null;
  let wall: HTMLElement | null = null;
  let notice: GfxWallNotice | null = null;

  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers();
    resetViewStatesForTests();
  });

  afterEach(() => {
    real?.dispose();
    real = null;
    notice?.dispose();
    notice = null;
    wall?.remove();
    wall = null;
    resetViewStatesForTests();
    setViewStateTileResolver(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("(a) MutationObserver: a solo pack tile leaves 0 wall notices showing, a solo non-pack tile exactly 1", async () => {
    real = realWall({ main: PACK_VIEW });
    const rec = recordWallNotices(real.wall);
    real.lose();
    await settle();
    const tile = real.tiles.get("main")!;
    expect(viewStateOf("main")).toMatchObject({ kind: "cant-draw", reason: "context-lost" });
    expect(tile.getAttribute(MARKER)).toBe("context-lost");
    expect(rec.leftShowing.size).toBe(0);
    expect(real.wall.querySelectorAll(SHOWN_WALL_NOTICE)).toHaveLength(0);
    expect(real.wall.querySelectorAll(TILE_SURFACE)).toHaveLength(1);
    expect(tileNotices(tile)).toHaveLength(1);
    expect(tileNotices(tile).every(inA11yTree)).toBe(true);
    // The wall's notice may stay in the DOM, hidden: out of the accessibility tree, not removed.
    expect(wallNotices(real.wall)).toHaveLength(1);
    expect(wallNotices(real.wall)[0]!.hidden).toBe(true);
    expect(inA11yTree(wallNotices(real.wall)[0]!)).toBe(false);
    expect(shownAlerts(real.wall)).toHaveLength(0);
    // Reload offered later: still said once, on the tile, and nothing on the wall takes focus.
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(rec.leftShowing.size).toBe(0);
    expect(real.wall.querySelectorAll(SHOWN_WALL_NOTICE)).toHaveLength(0);
    expect(real.wall.querySelectorAll(TILE_SURFACE)).toHaveLength(1);
    expect(wallNotices(real.wall)[0]!.contains(document.activeElement)).toBe(false);
    rec.stop();
    real.dispose();
    real = null;
    resetViewStatesForTests();

    real = realWall({ main: "topology" });
    const rec2 = recordWallNotices(real.wall);
    real.lose();
    await settle();
    const plain = real.tiles.get("main")!;
    expect(viewStateOf("main")).toMatchObject({ kind: "cant-draw", reason: "context-lost" });
    expect(plain.hasAttribute(MARKER)).toBe(false);
    expect(real.wall.querySelectorAll(TILE_SURFACE)).toHaveLength(0);
    expect(rec2.inserted).toHaveLength(1);
    expect(rec2.leftShowing.size).toBe(1);
    expect(real.wall.querySelectorAll(SHOWN_WALL_NOTICE)).toHaveLength(1);
    expect(shownAlerts(real.wall)).toHaveLength(1);
    expect(shownWallNotices(real.wall)[0]!.textContent).toBe(GFX_INTERRUPTED_NOTICE);
    rec2.stop();
  });

  it("(b) the wall notice follows the marker while it is up: set, cleared (pane now a non-pack view), set again", async () => {
    const solo = soloWall();
    wall = solo.wall;
    notice = new GfxWallNotice(wall);
    notice.onContextLost();
    const el = wallNotices(wall)[0]!;
    expect(wall.querySelectorAll(SHOWN_WALL_NOTICE)).toHaveLength(1);

    solo.mark("context-lost");
    await settle();
    expect(wall.querySelectorAll(SHOWN_WALL_NOTICE)).toHaveLength(0);
    expect(wall.querySelectorAll(TILE_SURFACE)).toHaveLength(1);
    expect(el.hidden).toBe(true);
    expect(inA11yTree(el)).toBe(false);

    // The pane switches to a non-pack view while the host is still interrupted: the wall says it again.
    solo.mark(null);
    await settle();
    expect(notice.showing).toBe("interrupted");
    expect(wall.querySelectorAll(TILE_SURFACE)).toHaveLength(0);
    expect(shownWallNotices(wall)).toEqual([el]);
    expect(inA11yTree(el)).toBe(true);
    expect(shownAlerts(wall)).toEqual([el]);
    expect(el.textContent).toBe(GFX_INTERRUPTED_NOTICE);

    solo.mark("context-lost");
    await settle();
    expect(wall.querySelectorAll(SHOWN_WALL_NOTICE)).toHaveLength(0);
    expect(wall.querySelectorAll(TILE_SURFACE)).toHaveLength(1);
    expect(el.hidden).toBe(true);

    // Reload offered while the tile says it; then the tile stops: the notice comes back with Reload focused.
    notice.offerReload();
    expect(notice.showing).toBe("reload");
    expect(el.contains(document.activeElement)).toBe(false);
    solo.mark(null);
    await settle();
    expect(shownWallNotices(wall)).toEqual([el]);
    expect(el.textContent).toContain(GFX_NO_RESTORE_NOTICE);
    expect(document.activeElement).toBe(el.querySelector(".gfx-wall-reload"));
    expect(wallNotices(wall)).toHaveLength(1);
  });

  it("(c) a \"shader\" marker is not the tile saying the loss: the wall notice stays", async () => {
    const solo = soloWall();
    wall = solo.wall;
    solo.mark("shader");
    notice = new GfxWallNotice(wall);
    notice.onContextLost();
    await settle();
    const el = wallNotices(wall)[0]!;
    expect(shownWallNotices(wall)).toEqual([el]);
    expect(shownAlerts(wall)).toEqual([el]);

    solo.mark("context-lost");
    await settle();
    expect(wall.querySelectorAll(SHOWN_WALL_NOTICE)).toHaveLength(0);
    solo.mark("shader");
    await settle();
    expect(shownWallNotices(wall)).toEqual([el]);
    expect(inA11yTree(el)).toBe(true);
    expect(shownAlerts(wall)).toEqual([el]);
  });

  it("(d) mixed mosaic (pack pane next to a built-in pane): one wall alert for the built-in pane, the pack pane keeps its own notice and Retry", async () => {
    real = realWall({ rcs: PACK_VIEW, b: "topology" });
    real.lose();
    await settle();
    const packPane = real.tiles.get("rcs")!;
    const builtIn = real.tiles.get("b")!;
    expect(packPane.getAttribute(MARKER)).toBe("context-lost");
    expect(builtIn.hasAttribute(MARKER)).toBe(false);
    expect(real.wall.querySelectorAll(SHOWN_WALL_NOTICE)).toHaveLength(1);
    expect(shownAlerts(real.wall)).toHaveLength(1);
    expect(packPane.querySelectorAll(TILE_SURFACE)).toHaveLength(1);
    expect(builtIn.querySelectorAll(TILE_SURFACE)).toHaveLength(0);
    const notices = tileNotices(packPane);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.getAttribute("role")).toBe("status");
    const retry = notices[0]!.querySelector("button");
    expect(retry?.textContent).toBe("Retry");
    expect(inA11yTree(retry!)).toBe(true);
    // The wall notice is the wall's, not the pane's: it holds neither the tile line nor its Retry.
    const wallEl = shownWallNotices(real.wall)[0]!;
    expect(wallEl.contains(retry)).toBe(false);
    expect(wallEl.textContent).not.toContain(TILE_LINE);
    expect(packPane.contains(wallEl)).toBe(false);
  });
});
