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

/**
 * Why a view waits on the operator: never approved (`consent`), or an earlier OK went stale —
 * the pack's content no longer matches it (`changed`), or the record predates a hash the pack
 * now has, such as assets_sha256 (`incomplete`). Both stale reasons read the same to the
 * operator ("needs your OK again"); the word "changed" is never shown.
 */
export type NeedsYouReason = "consent" | "changed" | "incomplete";

/** Why a view could not start. `missing`: a saved layout names a view that is not installed. */
export type CouldntStartReason = "timeout" | "load-failed" | "grant-failed" | "missing";

/**
 * Why a tile cannot draw (#171 c / #179): its own shader failed to compile or link (`shader`, one
 * tile), or the shared graphics context is lost (`context-lost`, every tile on the host).
 */
export type CantDrawReason = "shader" | "context-lost";

export type ViewState =
  | { kind: "starting" }
  | { kind: "ready" }
  | { kind: "needs-you"; reason: NeedsYouReason; packId: string }
  | { kind: "couldnt-start"; reason: CouldntStartReason; packId: string; log?: string }
  /** `log` is the shader info log: for the console line only, never painted on the tile. */
  | { kind: "cant-draw"; reason: "shader"; packId: string; log?: string }
  /**
   * `reload: true` once the wall offers Reload (the host stopped trying, or the notice's own
   * window ran out); absent while the wall still says it is restoring.
   */
  | { kind: "cant-draw"; reason: "context-lost"; reload?: true };

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
    case "changed":
    case "incomplete":
      return `${name} needs your OK again.`;
    default:
      return assertNever(reason);
  }
}

function cantDrawText(name: string, reason: CantDrawReason): string {
  switch (reason) {
    case "shader":
      return `${name} couldn't draw. Other tiles aren't affected. Pick another view, or reload to try again.`;
    case "context-lost":
      // Every tile is affected: never "Other tiles aren't affected" here (UX Pro, #171 c).
      return "Graphics stopped responding. Reload to get it back.";
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
    case "missing":
      return `${name} isn't installed. Pick another view for this tile.`;
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
      // Retry cannot bring back a view that is not installed: the notice has no button then.
      if (state.reason === "missing") return { text: couldntStartText(name, state.reason), action: null, button: null };
      return { text: couldntStartText(name, state.reason), action: "retry", button: "Retry" };
    case "cant-draw":
      // Copy only: which surface paints it (tile fallback, wall notice) and its button are #179 (c).
      return { text: cantDrawText(name, state.reason), action: null, button: null };
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
    case "cant-draw":
      // Not marked in the picker until UX Pro says so (#179 c): a lost context would mark every view.
      return null;
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
      return "changed";
    case "stale":
      return "incomplete";
    case "none":
    case "granted":
      return "consent";
    default:
      return assertNever(state);
  }
}

type TileEntry = { viewId: string; state: ViewState; el: HTMLElement | null };

const tiles = new Map<string, TileEntry>();
/**
 * What other writers asked for while a lost context held the tile: nothing draws until the
 * context is back, so a sky wait's "starting" / "ready" (or a clear) waits here and applies when
 * the tile leaves context-lost.
 */
const heldUnderContextLost = new Map<string, { viewId: string; state: ViewState | null; cleared?: true }>();
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
  if (prev && holdsContextLost(prev.state) && !holdsContextLost(state)) {
    heldUnderContextLost.set(tileId, { viewId, state });
    if (el) prev.el = el;
    return;
  }
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
  if (holdsContextLost(tiles.get(tileId)!.state)) {
    heldUnderContextLost.set(tileId, { viewId: tiles.get(tileId)!.viewId, state: null, cleared: true });
    return;
  }
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

function holdsContextLost(state: ViewState): boolean {
  return state.kind === "cant-draw" && state.reason === "context-lost";
}

/**
 * The shared context is lost: the tile can't draw (#179). Its current state is kept underneath
 * and comes back in `leaveContextLost`. `reload` once the wall offers Reload.
 */
export function enterContextLost(tileId: string, opts: { reload?: boolean } = {}): void {
  if (!tileId) return;
  const prev = tiles.get(tileId);
  if (prev && !holdsContextLost(prev.state)) heldUnderContextLost.set(tileId, { viewId: prev.viewId, state: prev.state });
  else if (!prev) heldUnderContextLost.set(tileId, { viewId: tileId, state: null });
  const state: ViewState = opts.reload
    ? { kind: "cant-draw", reason: "context-lost", reload: true }
    : { kind: "cant-draw", reason: "context-lost" };
  tiles.set(tileId, { viewId: prev?.viewId ?? tileId, state, el: prev?.el ?? null });
  stampViewState(tileId);
  notify(tileId);
}

/**
 * The context is back and a frame has drawn: the tile leaves context-lost. It returns to what it
 * was showing (Starting, Needs you, Couldn't start, a shader failure), else it is ready.
 */
export function leaveContextLost(tileId: string): void {
  const cur = tiles.get(tileId);
  if (!cur || !holdsContextLost(cur.state)) return;
  const under = heldUnderContextLost.get(tileId);
  heldUnderContextLost.delete(tileId);
  if (under?.cleared) {
    // A writer cleared the tile while it was lost (view torn down): forget it now.
    tiles.set(tileId, { ...cur, state: { kind: "ready" } });
    clearViewState(tileId);
    return;
  }
  const back = under?.state && under.state.kind !== "ready" ? under.state : { kind: "ready" as const };
  tiles.set(tileId, { viewId: under?.viewId ?? cur.viewId, state: back, el: cur.el });
  stampViewState(tileId);
  notify(tileId);
}

/** This tile's own shader failed to compile or link (#171 c). */
export function enterCantDrawShader(tileId: string, packId: string, log?: string): void {
  if (!tileId) return;
  const state: ViewState = log
    ? { kind: "cant-draw", reason: "shader", packId, log }
    : { kind: "cant-draw", reason: "shader", packId };
  setViewState(tileId, viewStateViewId(tileId) ?? tileId, state);
}

/** The tile's shader compiled, or its pack was swapped or cleared: a shader failure no longer holds. */
export function leaveCantDrawShader(tileId: string): void {
  const isShader = (s: ViewState | null | undefined) => s?.kind === "cant-draw" && s.reason === "shader";
  const under = heldUnderContextLost.get(tileId);
  if (under && isShader(under.state)) {
    heldUnderContextLost.set(tileId, { viewId: under.viewId, state: null });
    return;
  }
  if (isShader(tiles.get(tileId)?.state)) clearViewState(tileId);
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
  heldUnderContextLost.clear();
  tileEl = defaultTileEl;
}
