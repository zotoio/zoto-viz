import { expect } from "vitest";
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

export function mosaicLayoutPickerTrigger(settings: Settings): HTMLButtonElement {
  const el = settings.mosaicLayoutPickerTriggerEl()
    ?? settings.el.querySelector<HTMLButtonElement>(".mosaic-layout-picker-trigger");
  if (!el) throw new Error("missing mosaic layout picker trigger");
  return el;
}

/** happy-dom visibility: not hidden and not display:none / visibility:hidden. */
export function expectVisibleFocusTarget(el: HTMLElement): void {
  expect(el.hasAttribute("hidden")).toBe(false);
  expect(el.hidden).toBe(false);
  expect(el.style.display).not.toBe("none");
  expect(el.style.visibility).not.toBe("hidden");
  expect(el.closest("[hidden]")).toBeNull();
  if (typeof el.checkVisibility === "function") {
    expect(el.checkVisibility()).toBe(true);
  } else {
    expect(el.offsetParent).not.toBeNull();
  }
}
