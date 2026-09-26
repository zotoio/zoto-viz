import {
  GFX_INTERRUPTED_NOTICE,
  GFX_NO_RESTORE_NOTICE,
} from "./shader-fallback-copy";

export const GFX_WALL_NOTICE_CLASS = "gfx-wall-notice";
export const GFX_WALL_RELOAD_CLASS = "gfx-wall-reload";

/** Single wall-level status when the shared WebGL context is lost. */
export class GfxWallNotice {
  private el: HTMLDivElement | null = null;
  private shown = false;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly wall: HTMLElement) {}

  get element(): HTMLDivElement | null {
    return this.el;
  }

  get hasPendingReloadTimer(): boolean {
    return this.restoreTimer !== null;
  }

  onContextLost(): void {
    if (this.shown) return;
    this.shown = true;
    const el = document.createElement("div");
    el.className = GFX_WALL_NOTICE_CLASS;
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
    this.el?.remove();
    this.el = null;
    this.shown = false;
  }

  private onRestoreTimeout(): void {
    if (!this.el) return;
    this.el.textContent = "";
    const msg = document.createElement("span");
    msg.textContent = GFX_NO_RESTORE_NOTICE;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = GFX_WALL_RELOAD_CLASS;
    btn.textContent = "Reload";
    btn.addEventListener("click", () => location.reload());
    this.el.appendChild(msg);
    this.el.appendChild(btn);
  }
}
