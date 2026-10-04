/**
 * #273: on a real mosaic the pane that holds `#scene` (the main pane) counts as a tile like any
 * other. The main scene draws on the host as tile "main", but on a mosaic `#scene` sits inside a
 * pane and that pane's id is its tile (its card, its notices, its view state). On a lost context
 * the pane shows its own couldn't-draw line and Retry (when its view is a pack) and stops reporting
 * ready. When every pane, `#scene`'s included, says the loss itself, the wall notice hides and focus
 * goes to the first Retry in visual order (#246's stays-put rule unchanged); the failure is
 * announced once. #246's rows built boards from bare mosaic panes only, which is the case they missed.
 *
 * The rows run the real path: a RenderHost over a fake GL context, the lost event dispatched on its
 * canvas, bindCantDrawViewState + bindCantDrawSurface painting the tiles. The board is laid out as
 * Mosaic.placeTree lays it out (panes inside a `.mosaic-split` with a handle; a maximized pane alone
 * on the wall), `#scene` inside the main pane, tile ids resolved to panes as main.ts does in mosaic
 * mode (`.mosaic-pane[data-mode=<tile>]`). MutationObserver callbacks are flushed with awaited
 * microtasks; no clocks or timers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindCantDrawViewState } from "../app/cant-draw-state";
import { bindCantDrawSurface } from "../app/cant-draw-surface";
import { resetViewStatesForTests, setViewState, setViewStateTileResolver, viewStateOf } from "../app/view-state";
import { RenderHost, type HostedView } from "./render-host";

const RCS = "plugin:rocket-car-soccer";
const BACKROOMS = "plugin:backrooms";
const BUILT_IN = "topology";
const NAMES: Record<string, string> = { [RCS]: "Rocket Car Soccer", [BACKROOMS]: "Backrooms" };
const MARKER = "data-cant-draw-surface";
const SHOWN_WALL_NOTICE = ".gfx-wall-notice:not([hidden])";
const TILE_RETRY = ".tile-cant-draw__retry";

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

type Board = {
  wall: HTMLElement;
  scene: HTMLElement;
  pane: (id: string) => HTMLElement;
  /** The pane's own couldn't-draw line (role=status with the pack's sentence), if any. */
  line: (id: string) => HTMLElement | null;
  retry: (id: string) => HTMLButtonElement | null;
  /** role=status / role=alert nodes inserted on the board since it was built. */
  announced: Element[];
  lose: () => void;
  dispose: () => void;
};

/**
 * A mosaic as main.ts builds it. `panes` lists each pane's id (its view, as Mosaic keys panes by
 * mode) in board order; `sceneIn` is the main pane, which holds `#scene` and whose view the main
 * scene draws as host tile "main". `maximized` puts that one pane alone on the wall.
 */
function board(panes: string[], sceneIn: string, opts: { maximized?: string } = {}): Board {
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
  const scene = document.createElement("div");
  scene.id = "scene";
  box(scene);
  const els = new Map<string, HTMLElement>();
  for (const id of panes) {
    const pane = document.createElement("div");
    pane.className = "mosaic-pane";
    pane.dataset.mode = id;
    const chrome = document.createElement("div");
    chrome.className = "mosaic-chrome";
    const pick = document.createElement("select");
    pick.className = "mosaic-pick";
    pick.setAttribute("aria-label", "pane view");
    chrome.appendChild(pick);
    pane.appendChild(chrome);
    box(pane);
    els.set(id, pane);
  }
  els.get(sceneIn)!.appendChild(scene);
  if (opts.maximized) {
    const max = els.get(opts.maximized)!;
    max.classList.add("max");
    wall.appendChild(max);
  } else {
    // Mosaic.placeTree: the panes sit in a split with a handle between them, not on the wall itself.
    const split = document.createElement("div");
    split.className = "mosaic-split";
    split.dataset.dir = "h";
    panes.forEach((id, i) => {
      if (i > 0) {
        const handle = document.createElement("div");
        handle.className = "mosaic-handle";
        split.appendChild(handle);
      }
      split.appendChild(els.get(id)!);
    });
    wall.appendChild(split);
  }
  // The main scene draws as tile "main" into `#scene`; every other pane's view draws as its pane id.
  for (const id of panes) {
    const main = id === sceneIn;
    const view: HostedView = {
      viewEl: main ? scene : els.get(id)!,
      tileId: main ? "main" : id,
      hostFrame: () => { host.present(view, 0x000000, new THREE.Scene(), new THREE.PerspectiveCamera()); },
      hostContextLost: () => {},
      hostContextRestored: () => {},
    };
    host.add(view);
  }
  // main.ts in mosaic mode (skyWaitHostEl): a tile is the pane whose data-mode is its id.
  setViewStateTileResolver((id) => document.querySelector<HTMLElement>(`.mosaic-pane[data-mode="${CSS.escape(id)}"]`));
  // Each pane is showing its view (main.ts keys the main scene's pane by the pane id, skyWaitKey).
  for (const id of panes) setViewState(id, id, { kind: "ready" }, els.get(id));
  const announced: Element[] = [];
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n instanceof Element && (n.matches("[role=status], [role=alert]"))) announced.push(n);
      }
    }
  });
  obs.observe(wall, { childList: true, subtree: true });
  const stopState = bindCantDrawViewState(host);
  const stopSurface = bindCantDrawSurface(
    (viewId, packId) => NAMES[viewId] ?? packId,
    { isPack: (viewId) => viewId in NAMES, retry: () => host.recreateContext() },
  );
  host.advanceFrame(16);
  const line = (id: string): HTMLElement | null => {
    const name = NAMES[id];
    if (!name) return null;
    return [...els.get(id)!.querySelectorAll<HTMLElement>(":scope > .tile-cant-draw[role=status]")]
      .find((n) => (n.textContent ?? "").includes(`${name} couldn't draw.`)) ?? null;
  };
  return {
    wall,
    scene,
    pane: (id) => els.get(id)!,
    line,
    retry: (id) => line(id)?.querySelector<HTMLButtonElement>(TILE_RETRY) ?? null,
    announced,
    lose: () => { lost.on = true; host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); },
    dispose: () => { obs.disconnect(); stopState(); stopSurface(); host.dispose(); },
  };
}

const shownWallNotices = (b: Board) => b.wall.querySelectorAll(SHOWN_WALL_NOTICE).length;
const shownAlerts = (b: Board) => [...b.wall.querySelectorAll("[role=alert]")].filter(inA11yTree).length;

/** The pane says the loss itself: its marker, its own line with Retry (in the a11y tree), not ready. */
function expectPaneSaysLoss(b: Board, id: string): void {
  const pane = b.pane(id);
  expect(viewStateOf(id), `${id} view state`).toMatchObject({ kind: "cant-draw", reason: "context-lost" });
  expect(pane.dataset.viewState, `${id} data-view-state`).toBe("cant-draw");
  expect(pane.getAttribute(MARKER), `${id} marker`).toBe("context-lost");
  const line = b.line(id);
  expect(line, `${id} couldn't-draw line`).not.toBeNull();
  expect(inA11yTree(line!)).toBe(true);
  expect(b.retry(id)?.textContent, `${id} Retry`).toBe("Retry");
}

describe("#273: the pane holding #scene counts as a tile on a lost context", () => {
  let boards: Board[] = [];
  const make = (...args: Parameters<typeof board>): Board => {
    const b = board(...args);
    boards.push(b);
    return b;
  };

  beforeEach(() => {
    expect.hasAssertions();
    resetViewStatesForTests();
  });

  afterEach(() => {
    for (const b of boards) b.dispose();
    boards = [];
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.body.replaceChildren();
    resetViewStatesForTests();
    setViewStateTileResolver(null);
    vi.unstubAllGlobals();
  });

  it("(1) #scene + mosaic panes, all packs, lost: #scene's pane shows its own line + Retry and is not ready; 0 wall notices; focus on the first Retry in visual order, with a ring", async () => {
    // #scene in the first pane, then in the second: focus follows the board's order, not #scene.
    for (const [panes, sceneIn] of [[[RCS, BACKROOMS], RCS], [[BACKROOMS, RCS], RCS]] as const) {
      const b = make([...panes], sceneIn);
      b.lose();
      await settle();
      expectPaneSaysLoss(b, RCS);
      expectPaneSaysLoss(b, BACKROOMS);
      expect(b.pane(RCS).contains(b.scene)).toBe(true);
      expect(shownWallNotices(b)).toBe(0);
      expect(shownAlerts(b)).toBe(0);
      // The first pane on the board is its top-left one (a split's first child is its left/top side).
      expect(document.activeElement).toBe(b.retry(panes[0]));
      // Announced once: one line per pane, no wall alert left in the accessibility tree.
      expect(b.announced.filter((n) => n.matches("[role=status]") && inA11yTree(n))).toHaveLength(2);
      b.dispose();
      boards = [];
      document.body.replaceChildren();
      resetViewStatesForTests();
    }
    // The ring: a focused tile Retry is outlined (style.css).
    const css = readFileSync(resolve(__dirname, "../style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.tile-cant-draw__retry:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  });

  it("(2) mixed: #scene's pack pane failed next to a built-in pane (and the other way round) keeps the wall notice, and #scene's pane is not ready", async () => {
    const b = make([RCS, BUILT_IN], RCS);
    b.lose();
    await settle();
    expectPaneSaysLoss(b, RCS);
    expect(b.pane(BUILT_IN).hasAttribute(MARKER)).toBe(false);
    expect(b.pane(BUILT_IN).dataset.viewState).toBe("cant-draw");
    expect(shownWallNotices(b)).toBe(1);
    expect(shownAlerts(b)).toBe(1);
    expect(document.activeElement).toBe(document.body);
    b.dispose();
    boards = [];
    document.body.replaceChildren();
    resetViewStatesForTests();

    // #scene's pane shows a built-in view; the pack pane next to it says the loss.
    const v = make([BUILT_IN, BACKROOMS], BUILT_IN);
    v.lose();
    await settle();
    expectPaneSaysLoss(v, BACKROOMS);
    expect(viewStateOf(BUILT_IN)).toMatchObject({ kind: "cant-draw", reason: "context-lost" });
    expect(v.pane(BUILT_IN).dataset.viewState).toBe("cant-draw");
    expect(v.pane(BUILT_IN).hasAttribute(MARKER)).toBe(false);
    expect(shownWallNotices(v)).toBe(1);
    expect(document.activeElement).toBe(document.body);
  });

  it("(3) #scene's pane alone on the wall (maximized) shows its own line + Retry, is not ready, and takes the wall notice's place", async () => {
    const b = make([RCS, BACKROOMS], RCS, { maximized: RCS });
    b.lose();
    await settle();
    expectPaneSaysLoss(b, RCS);
    expect(shownWallNotices(b)).toBe(0);
    expect(document.activeElement).toBe(b.retry(RCS));
  });

  it("(4) stays put: focus in the header, a menu, settings or chat stays where it is; from inside the board (pane chrome) it moves; announced once", async () => {
    const outside: Array<[string, () => HTMLElement]> = [
      ["header", () => Object.assign(document.createElement("button"), { textContent: "view" })],
      ["menu", () => Object.assign(document.createElement("div"), { tabIndex: -1, role: "menuitem" })],
      ["settings", () => Object.assign(document.createElement("button"), { textContent: "settings" })],
      ["chat", () => document.createElement("input")],
    ];
    for (const [where, makeEl] of outside) {
      const b = make([RCS, BACKROOMS], RCS);
      const holder = document.createElement(where === "header" ? "header" : "div");
      const el = makeEl();
      holder.appendChild(el);
      document.body.prepend(holder);
      el.focus();
      expect(document.activeElement, where).toBe(el);
      b.lose();
      await settle();
      expectPaneSaysLoss(b, RCS);
      expect(shownWallNotices(b), where).toBe(0);
      expect(document.activeElement, `${where}: focus stays`).toBe(el);
      expect(shownAlerts(b)).toBe(0);
      expect(b.announced.filter((n) => n.matches("[role=status]") && inA11yTree(n))).toHaveLength(2);
      b.dispose();
      boards = [];
      document.body.replaceChildren();
      resetViewStatesForTests();
    }
    // From a non-Retry element inside the board (#scene's pane chrome): focus moves to the first Retry.
    const b = make([RCS, BACKROOMS], RCS);
    const pick = b.pane(RCS).querySelector<HTMLSelectElement>(".mosaic-pick")!;
    pick.focus();
    b.lose();
    await settle();
    expect(document.activeElement).toBe(b.retry(RCS));
  });
});
