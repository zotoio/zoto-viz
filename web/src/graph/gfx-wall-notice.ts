import {
  clearWallNotice,
  getWallNotice,
  postWallNotice,
  WALL_NOTICE_ACTION_CLASS,
} from "../core/wall-notice-region";
import {
  GFX_INTERRUPTED_NOTICE,
  GFX_NO_RESTORE_NOTICE,
} from "./shader-fallback-copy";

export type GfxWallNoticeOpts = {
  /** After the no-restore reload offer was showing and the context came back. */
  onDismissLateReload?: () => void;
};

/** Posts gfx context-loss copy through the shared wall-notice region. */
export class GfxWallNotice {
  private shown = false;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private reloadOffered = false;

  constructor(
    private readonly wall: HTMLElement,
    private readonly opts: GfxWallNoticeOpts = {},
  ) {}

  get hasPendingReloadTimer(): boolean {
    return this.restoreTimer !== null;
  }

  onContextLost(): void {
    if (this.shown) return;
    this.shown = true;
    postWallNotice({ key: "context-lost", text: GFX_INTERRUPTED_NOTICE }, this.wall);
    this.restoreTimer = setTimeout(() => this.onRestoreTimeout(), 10_000);
  }

  onContextRestored(): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    const btn = getWallNotice(this.wall, "context-not-restored")?.querySelector(
      `.${WALL_NOTICE_ACTION_CLASS}`,
    ) as HTMLButtonElement | null;
    const focusOnReload = btn !== null && document.activeElement === btn;
    const hadLateReload = this.reloadOffered;
    clearWallNotice(this.wall, "context-lost");
    clearWallNotice(this.wall, "context-not-restored");
    this.shown = false;
    this.reloadOffered = false;
    if (focusOnReload) {
      this.wall.tabIndex = -1;
      this.wall.focus();
    }
    if (hadLateReload) this.opts.onDismissLateReload?.();
  }

  private onRestoreTimeout(): void {
    if (!this.shown) return;
    this.reloadOffered = true;
    clearWallNotice(this.wall, "context-lost");
    postWallNotice(
      {
        key: "context-not-restored",
        text: GFX_NO_RESTORE_NOTICE,
        action: { label: "Reload", onClick: () => location.reload() },
      },
      this.wall,
    );
  }
}
