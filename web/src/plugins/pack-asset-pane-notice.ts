export type PaneNoticeRecipe = "default" | "fail" | "reconnecting";

export type PackAssetPaneNoticeOpts = {
  showRetry?: boolean;
  onRetry?: () => void;
  onRetryFocused?: () => void;
  /** Button words when the one action is not Retry (Needs you offers Review). */
  retryLabel?: string;
  /** `data-action` on the button, e.g. "review" or "retry". */
  retryAction?: string;
  showRemoveFromWall?: boolean;
  onRemoveFromWall?: () => void;
};

/** Paint inline pack-asset copy on a mosaic tile pane (shared by Mosaic and tests). */
export function paintPackAssetPaneNotice(
  pane: HTMLElement,
  text: string | null | undefined,
  recipe: PaneNoticeRecipe = "default",
  opts?: PackAssetPaneNoticeOpts,
): void {
  const existing = pane.querySelector(".mosaic-pane-notice");
  if (!text) {
    existing?.remove();
    pane.classList.remove("mosaic-pane-reconnecting");
    return;
  }
  const el = existing instanceof HTMLElement ? existing : document.createElement("div");
  if (!existing) {
    el.className = "mosaic-pane-notice";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    pane.appendChild(el);
  }
  el.classList.toggle("mosaic-pane-notice-fail", recipe === "fail");
  el.classList.toggle("mosaic-pane-notice-reconnecting", recipe === "reconnecting");
  pane.classList.toggle("mosaic-pane-reconnecting", recipe === "reconnecting");
  if (recipe !== "reconnecting") pane.classList.remove("mosaic-pane-reconnecting");
  el.replaceChildren();
  const span = document.createElement("span");
  span.className = "mosaic-pane-notice-text";
  span.textContent = text;
  el.append(span);
  if (opts?.showRetry && opts.onRetry) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mosaic-pane-notice-retry";
    btn.textContent = opts.retryLabel ?? "Retry";
    if (opts.retryAction) btn.dataset.action = opts.retryAction;
    // Keep the press on the button: tile camera / orbit handlers below must not capture it.
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.onRetry?.();
      focusPackAssetTile(pane);
      opts.onRetryFocused?.();
    });
    el.append(btn);
  }
  if (opts?.showRemoveFromWall && opts.onRemoveFromWall) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mosaic-pane-notice-remove";
    btn.textContent = "Remove from wall";
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.onRemoveFromWall?.();
      focusPackAssetTile(pane);
    });
    el.append(btn);
  }
}

export function focusPackAssetTile(pane: HTMLElement): void {
  if (!pane.hasAttribute("tabindex")) pane.setAttribute("tabindex", "-1");
  pane.focus();
}
