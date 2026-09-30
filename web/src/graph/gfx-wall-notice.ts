import {
  GFX_INTERRUPTED_NOTICE,
  GFX_NO_RESTORE_NOTICE,
} from "./shader-fallback-copy";

export type GfxWallNoticeOpts = {
  /** After the no-restore reload offer was showing and the context came back. */
  onDismissLateReload?: () => void;
};

/** Single wall-level status when the shared WebGL context is lost. */
export class GfxWallNotice {
  private el: HTMLDivElement | null = null;
  private shown = false;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private reloadOffered = false;

  constructor(
    private readonly wall: HTMLElement,
    private readonly opts: GfxWallNoticeOpts = {},
  ) {}

  onContextLost(): void {
    if (this.shown) return;
    this.shown = true;
    const el = document.createElement("div");
    el.className = "gfx-wall-notice";
    el.setAttribute("role", "status");
    el.tabIndex = -1;
    el.textContent = GFX_INTERRUPTED_NOTICE;
    this.wall.appendChild(el);
    this.el = el;
    this.restoreTimer = setTimeout(() => this.onRestoreTimeout(), 10_000);
  }

  onContextRestored(): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    const btn = this.el?.querySelector(".gfx-wall-reload") as HTMLButtonElement | null;
    const focusOnReload = btn !== null && document.activeElement === btn;
    const hadLateReload = this.reloadOffered;
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

  /** Drop the notice and its timer without the restored side effects (host disposed). */
  dispose(): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
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
  }
}
