import { fillViewSelect, viewSelectOptions } from "../plugins/plugin";
import { viewCaption, modeById } from "../core/modes";
import {
  allocateMosaicTileSlot,
  mosaicPlacedTileIndices,
  mosaicTileViewId,
  mosaicWallUsesView,
} from "../graph/mosaic-tile-id";
import { movePaneTileView, placePaneTileView } from "../graph/mosaic-layout";

export function mosaicViewOptionLabel(viewId: string, tileSlotIds: readonly string[]): string {
  const base = viewCaption(modeById(viewId));
  const tiles = mosaicPlacedTileIndices(tileSlotIds, viewId);
  if (!tiles.length) return base;
  if (tiles.length === 1) return `${base} (On tile ${tiles[0]})`;
  return `${base} (On tiles ${tiles.join(", ")})`;
}

export function fillMosaicViewSelect(
  sel: HTMLSelectElement,
  currentSlotId: string,
  tileSlotIds: readonly string[],
): void {
  const currentView = mosaicTileViewId(currentSlotId);
  fillViewSelect(sel, currentView);
  const placed = new Set(tileSlotIds.map(mosaicTileViewId));
  for (const o of sel.options) {
    if (!placed.has(o.value)) continue;
    o.textContent = mosaicViewOptionLabel(o.value, tileSlotIds);
    if (o.value === currentView) o.selected = true;
  }
  if (currentView && !viewSelectOptions().some((m) => m.value === currentView)) {
    const o = sel.querySelector<HTMLOptionElement>(`option[value="${CSS.escape(currentView)}"]`);
    if (o) o.selected = true;
  }
}

function focusableButtons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>("button")];
}

type DuplicateChoice = { kind: "add" } | { kind: "move"; tileIndex: number } | null;

function promptDuplicateChoice(viewId: string, tileSlotIds: readonly string[]): Promise<DuplicateChoice> {
  const tiles = mosaicPlacedTileIndices(tileSlotIds, viewId);
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "mosaic-pick-backdrop";
    const panel = document.createElement("div");
    panel.className = "mosaic-pick-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const title = document.createElement("div");
    title.className = "mosaic-pick-title";
    title.textContent = mosaicViewOptionLabel(viewId, tileSlotIds);
    const hint = document.createElement("div");
    hint.className = "mosaic-pick-hint";
    hint.textContent = "This view is already on the wall. Add another copy or move it from an existing tile.";
    panel.append(title, hint);

    const done = (choice: DuplicateChoice) => {
      backdrop.remove();
      resolve(choice);
    };

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "mosaic-pick-btn";
    addBtn.textContent = "Add another";
    addBtn.addEventListener("click", () => done({ kind: "add" }));

    const moveBtns = tiles.map((tileN) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mosaic-pick-btn";
      b.textContent = `Move from tile ${tileN}`;
      b.addEventListener("click", () => done({ kind: "move", tileIndex: tileN }));
      return b;
    });

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "mosaic-pick-btn link";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => done(null));

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) done(null); });
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); done(null); }
      if (e.key !== "Tab") return;
      const btns = focusableButtons(panel);
      if (!btns.length) return;
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.shiftKey
        ? btns[(i <= 0 ? btns.length : i) - 1]
        : btns[(i + 1) % btns.length];
      e.preventDefault();
      next?.focus();
    });

    panel.append(addBtn, ...moveBtns, cancel);
    backdrop.append(panel);
    document.body.append(backdrop);
    addBtn.focus();
  });
}

export function applyMosaicViewPick(
  tileSlotIds: readonly string[],
  fromSlot: string,
  viewId: string,
  choice: Exclude<DuplicateChoice, null>,
): string[] {
  const i = tileSlotIds.indexOf(fromSlot);
  if (i < 0) return [...tileSlotIds];
  if (choice.kind === "add") {
    const next = [...tileSlotIds];
    next[i] = allocateMosaicTileSlot(viewId, next.filter((_, j) => j !== i));
    return next;
  }
  const otherSlot = tileSlotIds[choice.tileIndex - 1];
  if (!otherSlot) return [...tileSlotIds];
  return movePaneTileView([...tileSlotIds], fromSlot, otherSlot);
}

/** Returns the next tile-slot list, or null when the user cancels. */
export async function pickMosaicViewForSlot(
  tileSlotIds: readonly string[],
  fromSlot: string,
  viewId: string,
): Promise<string[] | null> {
  if (!viewId || mosaicTileViewId(fromSlot) === viewId) return null;
  if (!mosaicWallUsesView(tileSlotIds, viewId)) {
    return placePaneTileView([...tileSlotIds], fromSlot, viewId);
  }
  const choice = await promptDuplicateChoice(viewId, tileSlotIds);
  if (!choice) return null;
  return applyMosaicViewPick(tileSlotIds, fromSlot, viewId, choice);
}
