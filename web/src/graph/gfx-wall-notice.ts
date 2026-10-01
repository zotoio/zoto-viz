import {
  GFX_INTERRUPTED_NOTICE,
  GFX_NO_RESTORE_NOTICE,
} from "./shader-fallback-copy";

export type GfxWallNoticeOpts = {
  /** After the no-restore reload offer was showing and the context came back. */
  onDismissLateReload?: () => void;
  /** The Reload copy and button are now on screen (the host gave up, or the 10 s window ran out). */
  onReloadOffered?: () => void;
};

/** The marker a tile's own surface sets while it says a lost context itself (#216, cant-draw-surface). */
const TILE_SURFACE_ATTR = "data-cant-draw-surface";
const TILE_SAYS_LOSS = "context-lost";
/** A tile's own Retry on its couldn't-draw line (cant-draw-surface). */
const TILE_RETRY = ".tile-cant-draw__retry";

/**
 * Single wall-level status when the shared WebGL context is lost.
 *
 * #236: a solo tile that already says the loss itself (a pack tile, #216: its own "couldn't draw"
 * line with Retry, marked `data-cant-draw-surface="context-lost"`) gets no second notice from the
 * wall: the wall notice stays in the DOM, keeps its state, and is `hidden` (out of the accessibility
 * tree, so the loss is announced once, by the tile). It follows the marker while the notice is up
 * (set, cleared or changed): a tile that stops saying it (e.g. switched to a non-pack view) gets the
 * wall notice back. A "shader" marker or a non-pack tile keeps the wall notice as before.
 *
 * #246: the same holds for a mosaic when every visible pane says the loss itself (an all-pack board):
 * the wall notice is `hidden`, and each pane keeps its own line and Retry. A mixed mosaic (any pane
 * not saying it) keeps the wall notice. Focus goes to the first tile's Retry once, when the board
 * becomes all-failed, and only if focus is on nothing (body) or inside the board on something that
 * is not a Retry; focus on a Retry or outside the board stays put. Later updates while the board stays
 * all-failed never move focus; leaving all-failed re-arms it.
 */
export class GfxWallNotice {
  private el: HTMLDivElement | null = null;
  private tileWatch: MutationObserver | null = null;
  private shown = false;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private reloadOffered = false;

  /** What the wall shows right now: nothing, "Graphics were interrupted", or the Reload copy. */
  get showing(): "none" | "interrupted" | "reload" {
    if (!this.el) return "none";
    return this.reloadOffered ? "reload" : "interrupted";
  }

  constructor(
    private readonly wall: HTMLElement,
    private readonly opts: GfxWallNoticeOpts = {},
  ) {}

  onContextLost(): void {
    if (this.shown) {
      // Lost again after a restore that never drew: a fresh "Restoring…" window, not a second notice.
      this.restartInterrupted();
      return;
    }
    this.shown = true;
    const el = document.createElement("div");
    el.className = "gfx-wall-notice";
    // #236: announced at once (role=alert); focus moves to its action when it has one (Reload).
    el.setAttribute("role", "alert");
    el.tabIndex = -1;
    el.textContent = GFX_INTERRUPTED_NOTICE;
    this.wall.appendChild(el);
    this.el = el;
    this.watchTiles();
    this.restoreTimer = setTimeout(() => this.onRestoreTimeout(), 10_000);
  }

  /** The wall's tiles: its mosaic panes, or with none, the solo scene. */
  private tiles(): HTMLElement[] {
    const panes = [...this.wall.querySelectorAll<HTMLElement>(":scope > .mosaic-pane")];
    return panes.length ? panes : [...this.wall.querySelectorAll<HTMLElement>(":scope > #scene")];
  }

  /** Every visible tile already says the loss itself (#236 solo, #246 all-pack mosaic): the wall notice would be a second one. */
  private tilesSayLoss(): boolean {
    const tiles = this.tiles().filter((t) => !t.hidden);
    return tiles.length > 0 && tiles.every((t) => t.getAttribute(TILE_SURFACE_ATTR) === TILE_SAYS_LOSS);
  }

  /** The first visible tile's own Retry, in board order (#246). */
  private firstTileRetry(): HTMLButtonElement | null {
    for (const tile of this.tiles()) {
      if (tile.hidden) continue;
      const retry = tile.querySelector<HTMLButtonElement>(TILE_RETRY);
      if (retry) return retry;
    }
    return null;
  }

  /** #246: focus may move to a tile's Retry only from nothing (body) or from inside the board, off a Retry. */
  private mayTakeFocus(): boolean {
    const active = document.activeElement;
    if (!active || active === document.body) return true;
    return this.wall.contains(active) && !active.matches(TILE_RETRY);
  }

  /** Hide or show the notice to match the tiles now; focus goes to Reload when it comes back with one. */
  private syncToTiles(): void {
    const el = this.el;
    if (!el) return;
    const hide = this.tilesSayLoss();
    if (el.hidden === hide) return;
    // The board just became all-failed (#246): the only moment focus may go to a tile's Retry.
    const retry = hide && this.mayTakeFocus() ? this.firstTileRetry() : null;
    if (retry) retry.focus();
    else if (hide && el.contains(document.activeElement)) {
      this.wall.tabIndex = -1;
      this.wall.focus();
    }
    el.hidden = hide;
    if (!hide) el.querySelector<HTMLButtonElement>(".gfx-wall-reload")?.focus();
  }

  /** While the notice is up, follow the tiles' surface marker and the wall's tiles coming and going. */
  private watchTiles(): void {
    this.syncToTiles();
    if (this.tileWatch || typeof MutationObserver === "undefined") return;
    this.tileWatch = new MutationObserver(() => this.syncToTiles());
    this.tileWatch.observe(this.wall, { subtree: true, childList: true, attributes: true, attributeFilter: [TILE_SURFACE_ATTR] });
  }

  private unwatchTiles(): void {
    this.tileWatch?.disconnect();
    this.tileWatch = null;
  }

  onContextRestored(): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    const btn = this.el?.querySelector(".gfx-wall-reload") as HTMLButtonElement | null;
    const focusOnReload = btn !== null && document.activeElement === btn;
    const hadLateReload = this.reloadOffered;
    this.unwatchTiles();
    this.el?.remove();
    this.el = null;
    this.shown = false;
    this.reloadOffered = false;
    if (focusOnReload) {
      this.wall.tabIndex = -1;
      this.wall.focus();
    }
    if (hadLateReload) this.opts.onDismissLateReload?.();
  }

  private restartInterrupted(): void {
    if (!this.el) return;
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.reloadOffered = false;
    // #236: Reload had focus and is about to go: hand focus to the wall, as a restore does, not to <body>.
    const focusOnReload = this.el.contains(document.activeElement);
    this.el.textContent = GFX_INTERRUPTED_NOTICE;
    if (focusOnReload) {
      this.wall.tabIndex = -1;
      this.wall.focus();
    }
    this.syncToTiles();
    this.restoreTimer = setTimeout(() => this.onRestoreTimeout(), 10_000);
  }

  /** Drop the notice and its timer without the restored side effects (host disposed). */
  dispose(): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    this.unwatchTiles();
    this.el?.remove();
    this.el = null;
    this.shown = false;
    this.reloadOffered = false;
  }

  /** The host has stopped trying to restore: switch to the Reload copy now (idempotent). */
  offerReload(): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    this.onRestoreTimeout();
  }

  private onRestoreTimeout(): void {
    if (!this.el || this.reloadOffered) return;
    this.reloadOffered = true;
    this.el.textContent = "";
    const msg = document.createElement("span");
    msg.textContent = GFX_NO_RESTORE_NOTICE;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gfx-wall-reload";
    btn.textContent = "Reload";
    btn.addEventListener("click", () => location.reload());
    this.el.appendChild(msg);
    this.el.appendChild(btn);
    if (!this.el.hidden) btn.focus();
    this.opts.onReloadOffered?.();
  }
}
