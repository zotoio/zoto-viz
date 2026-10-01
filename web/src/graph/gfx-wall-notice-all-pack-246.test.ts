/**
 * #246: in a mosaic where every visible pane says the lost context itself (an all-pack board: each
 * pane carries `data-cant-draw-surface="context-lost"` and its own `.tile-cant-draw` line with Retry),
 * the wall notice is `hidden`, so the board shows 0 `.gfx-wall-notice:not([hidden])` and N
 * `.tile-cant-draw`. A mixed mosaic (any pane not saying it) keeps the wall notice, as #236's row (d).
 *
 * Focus (UX Pro): it goes to the first tile's Retry once, at the moment the board becomes
 * all-failed, and only from nothing (body) or from inside the board off a Retry. Focus already on a
 * Retry or outside the board stays put; later updates while all-failed never take it back; leaving
 * all-failed re-arms it.
 *
 * The rows set the markers on the page the way cant-draw-surface does (no WebGL context is lost or
 * forced). MutationObserver callbacks are flushed with awaited microtasks; no clocks or timers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { GfxWallNotice } from "./gfx-wall-notice";

const MARKER = "data-cant-draw-surface";
const SHOWN_WALL_NOTICE = ".gfx-wall-notice:not([hidden])";
const TILE_SURFACE = ".tile-cant-draw";
const TILE_RETRY = ".tile-cant-draw__retry";

/** Let MutationObserver callbacks run (they are delivered as microtasks). */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

type Board = {
  wall: HTMLElement;
  panes: HTMLElement[];
  outside: HTMLButtonElement;
  /** Put the pane's own couldn't-draw line (with Retry) up, or take it down. */
  mark: (pane: HTMLElement, reason: string | null) => void;
  retryOf: (pane: HTMLElement) => HTMLButtonElement | null;
};

/** A wall with N mosaic panes, plus a button outside the board. */
function board(n: number): Board {
  const outside = document.createElement("button");
  outside.type = "button";
  outside.textContent = "outside";
  document.body.appendChild(outside);
  const wall = document.createElement("div");
  wall.id = "wall";
  const panes: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    const pane = document.createElement("div");
    pane.className = "mosaic-pane";
    pane.dataset.mode = `plugin:pack-${i}`;
    wall.appendChild(pane);
    panes.push(pane);
  }
  document.body.appendChild(wall);
  const mark = (pane: HTMLElement, reason: string | null): void => {
    pane.querySelector(TILE_SURFACE)?.remove();
    if (reason === null) {
      pane.removeAttribute(MARKER);
      return;
    }
    const surface = document.createElement("div");
    surface.className = TILE_SURFACE.slice(1);
    surface.setAttribute("role", "status");
    surface.dataset.reason = reason;
    const text = document.createElement("span");
    text.className = "tile-cant-draw__text";
    text.textContent = "Pack couldn't draw.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = TILE_RETRY.slice(1);
    retry.textContent = "Retry";
    surface.append(text, retry);
    pane.appendChild(surface);
    pane.setAttribute(MARKER, reason);
  };
  const retryOf = (pane: HTMLElement) => pane.querySelector<HTMLButtonElement>(TILE_RETRY);
  return { wall, panes, outside, mark, retryOf };
}

const shownWallNotices = (wall: HTMLElement) => wall.querySelectorAll(SHOWN_WALL_NOTICE).length;
const tileNotices = (wall: HTMLElement) => wall.querySelectorAll(TILE_SURFACE).length;

describe("#246: an all-pack mosaic shows no wall notice over the panes' own couldn't-draw lines", () => {
  let notice: GfxWallNotice | null = null;

  afterEach(() => {
    notice?.dispose();
    notice = null;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.body.replaceChildren();
  });

  it("(a) N panes all failed: 0 visible wall notices and N tile notices, whichever comes first", async () => {
    for (const n of [2, 3, 4]) {
      // Wall notice first, then each pane says it.
      const b = board(n);
      notice = new GfxWallNotice(b.wall);
      notice.onContextLost();
      expect(shownWallNotices(b.wall)).toBe(1);
      for (const pane of b.panes) b.mark(pane, "context-lost");
      await settle();
      expect(shownWallNotices(b.wall)).toBe(0);
      expect(tileNotices(b.wall)).toBe(n);
      const el = b.wall.querySelector<HTMLElement>(".gfx-wall-notice");
      expect(el?.hidden).toBe(true);
      notice.dispose();
      document.body.replaceChildren();

      // Panes marked before the wall is asked to show (#245 order).
      const b2 = board(n);
      for (const pane of b2.panes) b2.mark(pane, "context-lost");
      notice = new GfxWallNotice(b2.wall);
      notice.onContextLost();
      await settle();
      expect(shownWallNotices(b2.wall)).toBe(0);
      expect(tileNotices(b2.wall)).toBe(n);
      notice.dispose();
      notice = null;
      document.body.replaceChildren();
    }
  });

  it("(b) mixed mosaic keeps exactly 1 wall notice; it hides when the last pane says it and comes back when one stops", async () => {
    const b = board(3);
    notice = new GfxWallNotice(b.wall);
    notice.onContextLost();
    b.mark(b.panes[0]!, "context-lost");
    b.mark(b.panes[1]!, "context-lost");
    await settle();
    expect(shownWallNotices(b.wall)).toBe(1);
    expect(tileNotices(b.wall)).toBe(2);

    // A "shader" marker is not the pane saying the loss: still mixed.
    b.mark(b.panes[2]!, "shader");
    await settle();
    expect(shownWallNotices(b.wall)).toBe(1);

    b.mark(b.panes[2]!, "context-lost");
    await settle();
    expect(shownWallNotices(b.wall)).toBe(0);
    expect(tileNotices(b.wall)).toBe(3);

    // One pane switches to a non-pack view: the board is mixed again.
    b.mark(b.panes[1]!, null);
    await settle();
    expect(shownWallNotices(b.wall)).toBe(1);
    expect(tileNotices(b.wall)).toBe(2);
  });

  it("(c) focus lands on the first tile's Retry once, at the transition into all-failed", async () => {
    // From nothing (body).
    const b = board(3);
    notice = new GfxWallNotice(b.wall);
    notice.onContextLost();
    b.mark(b.panes[1]!, "context-lost");
    b.mark(b.panes[2]!, "context-lost");
    await settle();
    expect(document.activeElement).toBe(document.body);
    b.mark(b.panes[0]!, "context-lost");
    await settle();
    expect(document.activeElement).toBe(b.retryOf(b.panes[0]!));
    notice.dispose();
    document.body.replaceChildren();

    // From inside the board on something that is not a Retry (the pane itself).
    const b2 = board(2);
    notice = new GfxWallNotice(b2.wall);
    notice.onContextLost();
    b2.mark(b2.panes[1]!, "context-lost");
    await settle();
    b2.panes[1]!.tabIndex = -1;
    b2.panes[1]!.focus();
    expect(document.activeElement).toBe(b2.panes[1]);
    b2.mark(b2.panes[0]!, "context-lost");
    await settle();
    expect(document.activeElement).toBe(b2.retryOf(b2.panes[0]!));
  });

  it("(d) a later update while all-failed does not take focus back; leaving all-failed re-arms it", async () => {
    const b = board(3);
    notice = new GfxWallNotice(b.wall);
    notice.onContextLost();
    for (const pane of b.panes) b.mark(pane, "context-lost");
    await settle();
    expect(document.activeElement).toBe(b.retryOf(b.panes[0]!));

    // The user moves off the Retry (to nothing), then the board keeps updating.
    b.retryOf(b.panes[0]!)?.blur();
    expect(document.activeElement).toBe(document.body);
    b.mark(b.panes[1]!, "context-lost"); // a pane repaints its line
    await settle();
    notice.offerReload(); // the wall switches to its Reload copy, still hidden
    await settle();
    notice.onContextLost(); // lost again: a fresh interrupted window
    await settle();
    expect(shownWallNotices(b.wall)).toBe(0);
    expect(document.activeElement).toBe(document.body);

    // The board leaves all-failed, then becomes all-failed again: focus goes to the first Retry once more.
    b.mark(b.panes[2]!, null);
    await settle();
    expect(shownWallNotices(b.wall)).toBe(1);
    expect(document.activeElement).toBe(document.body);
    b.mark(b.panes[2]!, "context-lost");
    await settle();
    expect(shownWallNotices(b.wall)).toBe(0);
    expect(document.activeElement).toBe(b.retryOf(b.panes[0]!));
  });

  it("(e) focus already on a Retry, or outside the board, stays put at the transition", async () => {
    const b = board(3);
    notice = new GfxWallNotice(b.wall);
    notice.onContextLost();
    b.mark(b.panes[1]!, "context-lost");
    b.mark(b.panes[2]!, "context-lost");
    await settle();
    const onRetry = b.retryOf(b.panes[2]!);
    onRetry?.focus();
    expect(document.activeElement).toBe(onRetry);
    b.mark(b.panes[0]!, "context-lost");
    await settle();
    expect(shownWallNotices(b.wall)).toBe(0);
    expect(document.activeElement).toBe(onRetry);
    notice.dispose();
    document.body.replaceChildren();

    const b2 = board(2);
    notice = new GfxWallNotice(b2.wall);
    notice.onContextLost();
    b2.mark(b2.panes[0]!, "context-lost");
    await settle();
    b2.outside.focus();
    expect(document.activeElement).toBe(b2.outside);
    b2.mark(b2.panes[1]!, "context-lost");
    await settle();
    expect(shownWallNotices(b2.wall)).toBe(0);
    expect(document.activeElement).toBe(b2.outside);
  });
});
