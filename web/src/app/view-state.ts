/**
 * One ViewState per tile (tile id "main" for the solo wall, the pane id in a mosaic). Every surface
 * reads it: the tile element and the card / notice inside it carry `data-view-state` and
 * `data-view-id`, and all copy comes from `viewStateCopy` (a switch that ends in `assertNever`, so a
 * new kind or reason cannot ship without its words).
 *
 * Kept free of plugin imports so sky waits, consent and mosaic code can all write to it.
 */

import { skyStartingText } from "../graph/sky-starting-card";
import { paintPackAssetPaneNotice } from "../plugins/pack-asset-pane-notice";
import { packSkyTimedOut } from "../plugins/plugin-copy";
import type { ConsentState } from "./consent-store";

/** Why a view waits on the operator. */
export type NeedsYouReason = "consent" | "consent-changed" | "consent-stale";

/** Why a view could not start. */
export type CouldntStartReason = "timeout" | "load-failed" | "grant-failed";

export type ViewState =
  | { kind: "starting" }
  | { kind: "ready" }
  | { kind: "needs-you"; reason: NeedsYouReason; packId: string }
  | { kind: "couldnt-start"; reason: CouldntStartReason; packId: string; log?: string };

export type ViewStateKind = ViewState["kind"];

/** The one button a state offers (the spec allows one message and one button). */
export type ViewStateAction = "review" | "retry" | null;

export type ViewStateCopy = { text: string | null; action: ViewStateAction; button: string | null };

export function assertNever(x: never): never {
  throw new Error(`unhandled view state: ${JSON.stringify(x)}`);
}

function needsYouText(name: string, reason: NeedsYouReason): string {
  switch (reason) {
    case "consent":
      return `${name} needs your OK to run.`;
    case "consent-changed":
      return `${name} has changed since you approved it.`;
    case "consent-stale":
      return `${name} needs a fresh OK after an update.`;
    default:
      return assertNever(reason);
  }
}

function couldntStartText(name: string, reason: CouldntStartReason): string {
  switch (reason) {
    case "timeout":
      return packSkyTimedOut(name);
    case "load-failed":
    case "grant-failed":
      return `${name} couldn't start.`;
    default:
      return assertNever(reason);
  }
}

/** Plain copy for a state: one sentence and at most one button. */
export function viewStateCopy(state: ViewState, viewName: string): ViewStateCopy {
  const name = viewName.trim() || "This view";
  switch (state.kind) {
    case "starting":
      return { text: skyStartingText(name), action: null, button: null };
    case "ready":
      return { text: null, action: null, button: null };
    case "needs-you":
      return { text: needsYouText(name, state.reason), action: "review", button: "Review" };
    case "couldnt-start":
      return { text: couldntStartText(name, state.reason), action: "retry", button: "Retry" };
    default:
      return assertNever(state);
  }
}

/** Short trailing word for the picker; only the two states that need attention are marked. */
export function viewStatePickerSuffix(state: ViewState | null | undefined): string | null {
  if (!state) return null;
  switch (state.kind) {
    case "starting":
    case "ready":
      return null;
    case "needs-you":
      return "needs OK";
    case "couldnt-start":
      return "couldn't start";
    default:
      return assertNever(state);
  }
}

/** The `data-view-state` value: the kind, the same on every surface of the tile. */
export function viewStateAttr(state: ViewState): ViewStateKind {
  return state.kind;
}

export function needsYouReasonFor(state: ConsentState): NeedsYouReason {
  switch (state) {
    case "changed":
      return "consent-changed";
    case "stale":
      return "consent-stale";
    case "none":
    case "granted":
      return "consent";
    default:
      return assertNever(state);
  }
}

type TileEntry = { viewId: string; state: ViewState; el: HTMLElement | null };

const tiles = new Map<string, TileEntry>();
const listeners = new Set<(tileId: string) => void>();

function defaultTileEl(tileId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (tileId === "main") return document.getElementById("scene");
  return document.querySelector<HTMLElement>(`.mosaic-pane[data-mode="${CSS.escape(tileId)}"]`);
}

let tileEl: (tileId: string) => HTMLElement | null = defaultTileEl;

/** The host decides which element is a tile (solo `#scene`, or a mosaic pane). */
export function setViewStateTileResolver(fn: ((tileId: string) => HTMLElement | null) | null): void {
  tileEl = fn ?? defaultTileEl;
}

/** The tile's element: the host resolver first, else the element the writer handed in. */
export function viewStateTileEl(tileId: string): HTMLElement | null {
  const found = tileEl(tileId);
  if (found) return found;
  return tiles.get(tileId)?.el ?? null;
}

/** Surfaces of a tile that must agree with it: its own card and notice (not a nested pane's). */
const SURFACES = ":scope > .sky-starting-card, :scope > .mosaic-pane-notice";

function stampEl(el: HTMLElement, entry: Pick<TileEntry, "viewId" | "state">): void {
  el.dataset.viewState = viewStateAttr(entry.state);
  el.dataset.viewId = entry.viewId;
}

/** Write the tile's state onto its element and every card / notice inside it. */
export function stampViewState(tileId: string): void {
  const entry = tiles.get(tileId);
  const el = viewStateTileEl(tileId);
  if (!entry || !el) return;
  stampEl(el, entry);
  el.querySelectorAll<HTMLElement>(SURFACES).forEach((s) => stampEl(s, entry));
}

function removeStateNotice(el: HTMLElement | null): void {
  el?.querySelector<HTMLElement>(":scope > .mosaic-pane-notice[data-view-state]")?.remove();
}

function notify(tileId: string): void {
  for (const fn of [...listeners]) {
    try {
      fn(tileId);
    } catch (e) {
      console.warn("zoto-viz view state listener:", e);
    }
  }
}

/**
 * Record a tile's state. Moving to starting or ready takes down a Needs you / Couldn't start
 * notice this map painted; the card and notice painters stamp their own element through here.
 */
export function setViewState(tileId: string, viewId: string, state: ViewState, el?: HTMLElement | null): void {
  if (!tileId) return;
  const prev = tiles.get(tileId);
  tiles.set(tileId, { viewId, state, el: el ?? prev?.el ?? null });
  if ((state.kind === "starting" || state.kind === "ready")
    && (prev?.state.kind === "needs-you" || prev?.state.kind === "couldnt-start")) {
    removeStateNotice(viewStateTileEl(tileId));
  }
  stampViewState(tileId);
  notify(tileId);
}

export function viewStateOf(tileId: string): ViewState | null {
  return tiles.get(tileId)?.state ?? null;
}

export function viewStateViewId(tileId: string): string | null {
  return tiles.get(tileId)?.viewId ?? null;
}

/** Forget a tile (view torn down): attributes come off its element. */
export function clearViewState(tileId: string): void {
  if (!tiles.has(tileId)) return;
  const el = viewStateTileEl(tileId);
  const prev = tiles.get(tileId)!;
  tiles.delete(tileId);
  if (el) {
    if (prev.state.kind === "needs-you" || prev.state.kind === "couldnt-start") removeStateNotice(el);
    delete el.dataset.viewState;
    el.querySelectorAll<HTMLElement>(SURFACES).forEach((s) => { delete s.dataset.viewState; });
  }
  notify(tileId);
}

export function onViewStateChange(fn: (tileId: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export type ViewStateActions = {
  onReview?: () => void;
  onRetry?: () => void;
  /** After the button's click moved focus to the tile (e.g. to focus the review panel). */
  onActionFocused?: () => void;
};

/**
 * Record a state and paint its notice on the tile: Needs you gets Review, Couldn't start gets
 * Retry. Starting and ready paint nothing here (the starting card belongs to the sky wait).
 */
export function showViewState(
  tileId: string,
  viewId: string,
  viewName: string,
  state: ViewState,
  actions: ViewStateActions = {},
  hostEl?: HTMLElement | null,
): void {
  const el = tileEl(tileId) ?? hostEl ?? null;
  if (el && (state.kind === "needs-you" || state.kind === "couldnt-start")) {
    const copy = viewStateCopy(state, viewName);
    const onAction = copy.action === "review" ? actions.onReview : copy.action === "retry" ? actions.onRetry : undefined;
    paintPackAssetPaneNotice(el, copy.text, "fail", onAction
      ? { showRetry: true, onRetry: onAction, retryLabel: copy.button ?? undefined, retryAction: copy.action ?? undefined, onRetryFocused: actions.onActionFocused }
      : undefined);
  }
  setViewState(tileId, viewId, state, el);
}

/** Tiles only: host listeners registered at module load stay. */
export function resetViewStatesForTests(): void {
  tiles.clear();
  tileEl = defaultTileEl;
}
