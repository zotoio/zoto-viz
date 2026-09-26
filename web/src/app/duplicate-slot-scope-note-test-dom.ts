import type { Settings } from "../ui/settings";

/** Open settings flyout that hosts the view drawer while editing a view. */
export function settingsViewDrawerRoot(settings: Settings): HTMLDivElement {
  const el = settings.el.querySelector<HTMLDivElement>(".settings-pop.drawer");
  if (!el) throw new Error("missing .settings-pop.drawer");
  return el;
}

export function viewDrawerStatusLine(settings: Settings): HTMLElement | null {
  const el = settings.el.querySelector<HTMLElement>(".view-drawer-status");
  if (!el || el.hidden) return null;
  return el;
}

export function mosaicLayoutSelects(settings: Settings): HTMLSelectElement[] {
  return [...settings.el.querySelectorAll<HTMLSelectElement>(".mosaic-slot")];
}
