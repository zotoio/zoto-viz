/**
 * #272: follow-ups to #246 that did not hold the land.
 *
 * - `hidden` is in the tile observer's attributeFilter, so hiding a pane re-checks.
 * - A board with no visible tile keeps the wall notice and does not move focus.
 * - Adding or removing a pane re-checks.
 * - A solo pack tile (one #scene, with its own Retry) takes focus once.
 * - When the board leaves all-failed while Reload is offered, Reload takes focus only from
 *   body or from a tile that is already hidden. Focus in the header stays put. The Reload
 *   sentence is set once on the polite region either way.
 *
 * Markers are set the way cant-draw-surface sets them. MutationObserver callbacks flush as
 * microtasks. No clocks.
 */
import { afterEach, describe, expect, it } from "vitest";
import { GFX_NO_RESTORE_NOTICE } from "./shader-fallback-copy";
import { GfxWallNotice } from "./gfx-wall-notice";

const MARKER = "data-cant-draw-surface";
const SHOWN = ".gfx-wall-notice:not([hidden])";
const TILE_RETRY = ".tile-cant-draw__retry";

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

function countSets(el: HTMLElement, text: string): { n: () => number } {
  let n = 0;
  let proto: object | null = el;
  let desc: PropertyDescriptor | undefined;
  while (proto && !desc) {
    proto = Object.getPrototypeOf(proto);
    desc = proto ? Object.getOwnPropertyDescriptor(proto, "textContent") : undefined;
  }
  Object.defineProperty(el, "textContent", {
    configurable: true,
    get() { return desc?.get?.call(el); },
    set(v: string) {
      if (v === text) n += 1;
      desc?.set?.call(el, v);
    },
  });
  return { n: () => n };
}

type Board = {
  wall: HTMLElement;
  header: HTMLButtonElement;
  panes: HTMLElement[];
  mark: (pane: HTMLElement, reason: string | null) => void;
  retryOf: (pane: HTMLElement) => HTMLButtonElement | null;
};

function board(n: number): Board {
  const header = document.createElement("button");
  header.type = "button";
  header.id = "bar";
  header.textContent = "header";
  document.body.appendChild(header);
  const wall = document.createElement("div");
  wall.id = "wall";
  const panes: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    const pane = document.createElement("div");
    pane.className = "mosaic-pane";
    wall.appendChild(pane);
    panes.push(pane);
  }
  document.body.appendChild(wall);
  const mark = (pane: HTMLElement, reason: string | null): void => {
    pane.querySelector(".tile-cant-draw")?.remove();
    if (reason === null) {
      pane.removeAttribute(MARKER);
      return;
    }
    const surface = document.createElement("div");
    surface.className = "tile-cant-draw";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "tile-cant-draw__retry";
    retry.textContent = "Retry";
    surface.appendChild(retry);
    pane.appendChild(surface);
    pane.setAttribute(MARKER, reason);
  };
  return {
    wall,
    header,
    panes,
    mark,
    retryOf: (pane) => pane.querySelector<HTMLButtonElement>(TILE_RETRY),
  };
}

const shown = (wall: HTMLElement) => wall.querySelectorAll(SHOWN).length;

describe("#272 wall notice follow-ups", () => {
  let notice: GfxWallNotice | null = null;

  afterEach(() => {
    notice?.dispose();
    notice = null;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.body.replaceChildren();
  });

  it("hiding the pane that is not saying the loss re-checks, and the wall notice hides", async () => {
    const b = board(2);
    notice = new GfxWallNotice(b.wall);
    notice.onContextLost();
    b.mark(b.panes[0]!, "context-lost");
    await settle();
    expect(shown(b.wall)).toBe(1);
    b.panes[1]!.hidden = true;
    await settle();
    expect(shown(b.wall)).toBe(0);
  });

  it("(a) a board with no visible tile keeps the wall notice and does not move focus", async () => {
    const b = board(2);
    notice = new GfxWallNotice(b.wall);
    notice.onContextLost();
    b.header.focus();
    expect(document.activeElement).toBe(b.header);
    b.panes[0]!.hidden = true;
    b.panes[1]!.hidden = true;
    await settle();
    expect(shown(b.wall)).toBe(1);
    expect(document.activeElement).toBe(b.header);
  });

  it("(b) adding a drawing pane brings the wall notice back; removing it hides the notice again", async () => {
    const b = board(2);
    notice = new GfxWallNotice(b.wall);
    notice.onContextLost();
    for (const pane of b.panes) b.mark(pane, "context-lost");
    await settle();
    expect(shown(b.wall)).toBe(0);
    const drawing = document.createElement("div");
    drawing.className = "mosaic-pane";
    b.wall.appendChild(drawing);
    await settle();
    expect(shown(b.wall)).toBe(1);
    drawing.remove();
    await settle();
    expect(shown(b.wall)).toBe(0);
  });

  it("(c) a solo pack tile moves focus to its Retry once when the loss shows", async () => {
    const wall = document.createElement("div");
    const scene = document.createElement("div");
    scene.id = "scene";
    wall.appendChild(scene);
    document.body.appendChild(wall);
    const surface = document.createElement("div");
    surface.className = "tile-cant-draw";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "tile-cant-draw__retry";
    retry.textContent = "Retry";
    surface.appendChild(retry);
    scene.appendChild(surface);
    scene.setAttribute(MARKER, "context-lost");
    notice = new GfxWallNotice(wall);
    notice.onContextLost();
    await settle();
    expect(shown(wall)).toBe(0);
    expect(document.activeElement).toBe(retry);
    retry.blur();
    expect(document.activeElement).toBe(document.body);
    scene.appendChild(document.createElement("span"));
    await settle();
    expect(shown(wall)).toBe(0);
    expect(document.activeElement).toBe(document.body);
  });

  it("Reload stays off the header and takes body, and the polite line is set once", async () => {
    const b = board(2);
    notice = new GfxWallNotice(b.wall);
    notice.onContextLost();
    for (const pane of b.panes) b.mark(pane, "context-lost");
    await settle();
    notice.offerReload();
    const polite = b.wall.querySelector<HTMLElement>("[aria-live=polite]");
    if (!polite) throw new Error("no polite region");
    const line = countSets(polite, GFX_NO_RESTORE_NOTICE);
    b.header.focus();
    b.mark(b.panes[0]!, null);
    await settle();
    expect(document.activeElement).toBe(b.header);
    expect(shown(b.wall)).toBe(1);
    expect(line.n()).toBe(1);
    expect(polite.textContent).toBe(GFX_NO_RESTORE_NOTICE);
    notice.dispose();
    document.body.replaceChildren();

    const b2 = board(2);
    notice = new GfxWallNotice(b2.wall);
    notice.onContextLost();
    for (const pane of b2.panes) b2.mark(pane, "context-lost");
    await settle();
    notice.offerReload();
    const polite2 = b2.wall.querySelector<HTMLElement>("[aria-live=polite]");
    if (!polite2) throw new Error("no polite region");
    const line2 = countSets(polite2, GFX_NO_RESTORE_NOTICE);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    expect(document.activeElement).toBe(document.body);
    b2.mark(b2.panes[0]!, null);
    await settle();
    expect(document.activeElement).toBe(b2.wall.querySelector(".gfx-wall-reload"));
    expect(line2.n()).toBe(1);
    expect(polite2.textContent).toBe(GFX_NO_RESTORE_NOTICE);
  });
});
