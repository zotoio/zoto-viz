export const VIEW_COG_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true" width="16" height="16"><path fill="currentColor" d="M11.4 1.6a1 1 0 0 0-2.8 0l-.2 1.4a6.6 6.6 0 0 0-1.5.6L5.6 2.8a1 1 0 0 0-1.4 0L2.8 4.2a1 1 0 0 0 0 1.4l.9 1.2a6.6 6.6 0 0 0-.6 1.5l-1.5.2a1 1 0 0 0 0 2.8l1.4.2q.2.8.6 1.5l-.9 1.2a1 1 0 0 0 0 1.4l1.4 1.4a1 1 0 0 0 1.4 0l1.2-.9q.7.4 1.5.6l.2 1.5a1 1 0 0 0 2.8 0l.2-1.4q.8-.2 1.5-.6l1.2.9a1 1 0 0 0 1.4 0l1.4-1.4a1 1 0 0 0 0-1.4l-.9-1.2q.4-.7.6-1.5l1.5-.2a1 1 0 0 0 0-2.8l-1.4-.2a6.6 6.6 0 0 0-.6-1.5l.9-1.2a1 1 0 0 0 0-1.4l-1.4-1.4a1 1 0 0 0-1.4 0l-1.2.9a6.6 6.6 0 0 0-1.5-.6zM10 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>`;

/** Header view cog and the per-pane corner cogs share this button. */
export function makeViewCogButton(opts: {
  className?: string;
  title?: string;
  ariaLabel?: string;
  pane?: string;
  onClick: (e: MouseEvent) => void;
}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.className ?? "cog plugin-cog";
  btn.title = opts.title ?? "this view";
  btn.setAttribute("aria-label", opts.ariaLabel ?? "this view settings");
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  if (opts.pane) btn.dataset.pane = opts.pane;
  btn.innerHTML = VIEW_COG_SVG;
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onClick(e);
  });
  return btn;
}
