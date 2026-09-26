import type { Settings } from "../../ui/settings";

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

export function mosaicLayoutPickerTrigger(settings: Settings): HTMLButtonElement {
  const el = settings.el.querySelector<HTMLButtonElement>(".mosaic-layout-picker-trigger");
  if (!el) throw new Error("missing mosaic layout picker trigger");
  return el;
}

/** happy-dom visibility: not hidden and not display:none / visibility:hidden. */
export function expectVisibleFocusTarget(el: HTMLElement): void {
  if (el.hasAttribute("hidden")) throw new Error("focus target has hidden attribute");
  if (el.hidden) throw new Error("focus target is hidden");
  if (el.style.display === "none") throw new Error("focus target display:none");
  if (el.style.visibility === "hidden") throw new Error("focus target visibility:hidden");
  if (el.closest("[hidden]")) throw new Error("focus target inside hidden ancestor");
  if (typeof el.checkVisibility === "function") {
    if (!el.checkVisibility()) throw new Error("focus target not checkVisibility");
  } else if (el.offsetParent === null) {
    throw new Error("focus target offsetParent null");
  }
}
