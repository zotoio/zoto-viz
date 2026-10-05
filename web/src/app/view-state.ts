/**
 * One ViewState per tile (tile id "main" for the solo wall, the pane id in a mosaic). Every surface
 * reads it: the tile element and the card / notice inside it carry `data-view-state` and
 * `data-view-id`, and all copy comes from `viewStateCopy` (a switch that ends in `assertNever`, so a
 * new kind or reason cannot ship without its words).
 *
 * Kept free of plugin imports so sky waits, consent and mosaic code can all write to it.
 */

import { skyStartingText } from "../graph/sky-starting-card";
import { GFX_INTERRUPTED_NOTICE, GFX_NO_RESTORE_NOTICE } from "../graph/shader-fallback-copy";
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

function cantDrawText(name: string, state: Extract<ViewState, { kind: "cant-draw" }>, solo: boolean): string {
  switch (state.reason) {
    case "shader":
      // A solo tile has no other tiles to reassure about (UX Pro, 36ec34ae review).
      return solo
        ? `${name} couldn't draw. Pick another view, or reload to try again.`
        : `${name} couldn't draw. Other tiles aren't affected. Pick another view, or reload to try again.`;
    case "context-lost":
      // Word for word what the wall notice shows at this moment (its own constants, so they can't
      // drift): "Restoring…" until Reload is offered, then the Reload sentence. Never "Other tiles
      // aren't affected": every tile is.
      return state.reload ? GFX_NO_RESTORE_NOTICE : GFX_INTERRUPTED_NOTICE;
    default:
      return assertNever(state);
  }
}

/**
 * Where the copy lands: the tile id ("main" is the solo wall) and how many tiles are on the wall.
 * Required, so no caller can fall into the mosaic sentence by leaving it out: solo (tile "main" or
 * the only tile) drops "Other tiles aren't affected". {@link viewStateTile} works it out from the DOM.
 */
export type ViewStateCopyTile = { tileId: string; tileCount: number };

/**
 * The tile a notice lands on: "main" is the solo wall (1 tile); a mosaic pane counts the panes on
 * its wall (panes are the wall's direct children). An element that is not a mosaic pane is alone.
 */
export function viewStateTile(tileId: string, el: HTMLElement | null): ViewStateCopyTile {
  if (tileId === "main" || !el?.classList.contains("mosaic-pane")) return { tileId, tileCount: 1 };
  const panes = el.parentElement?.querySelectorAll(":scope > .mosaic-pane").length ?? 1;
  return { tileId, tileCount: Math.max(1, panes) };
}

function isSoloTile(tile: ViewStateCopyTile): boolean {
  return tile.tileId === "main" || tile.tileCount === 1;
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

/**
 * Where else the copy is shaped: `pack` when the tile's view is a pack with its own frontend
 * (#216). Such a tile says a lost context on the tile itself, with Retry; other tiles leave it to
 * the wall notice.
 */
export type ViewStateCopyOpts = { pack?: boolean };

/** Plain copy for a state: one sentence and at most one button. */
export function viewStateCopy(
  state: ViewState,
  viewName: string,
  tile: ViewStateCopyTile,
  opts: ViewStateCopyOpts = {},
): ViewStateCopy {
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
      // A pack draws its own picture: without its own line the board is silently blank (#216).
      // Retry asks for the context back; the wall notice still says the loss for everyone.
      if (state.reason === "context-lost" && opts.pack) return { text: `${name} couldn't draw.`, action: "retry", button: "Retry" };
      // Copy only: which surface paints it (tile fallback, wall notice) and its button are #179 (c).
      return { text: cantDrawText(name, state, isSoloTile(tile)), action: null, button: null };
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
const heldUnderContextLost = new Map<string, { viewId: string; state: ViewState | null; cleared?: true; paint?: () => void }>();
/**
 * #216: the Retry of a tile's Couldn't start / load-failed (a pack load that failed). A lost context
 * takes that notice down (the tile says it can't draw); when the context is back and drew, the
 * load runs again once through this Retry, and only a failed rerun shows Couldn't start again.
 */
const loadRetry = new Map<string, () => void>();

function isLoadFailed(state: ViewState | null | undefined): boolean {
  return state?.kind === "couldnt-start" && state.reason === "load-failed";
}
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

/**
 * The view-state key for a tile id the render host reports. The main scene draws as tile
 * "main", but on a mosaic `#scene` sits inside a pane, and that pane's id is the tile everywhere
 * else (its sky wait, card, notices and state; main.ts keys it by the pane id): the pane holding
 * `#scene` counts as a tile like any other. On the solo wall "main" stays "main".
 */
export function viewStateTileKey(tileId: string): string {
  if (tileId !== "main" || typeof document === "undefined") return tileId;
  const pane = document.getElementById("scene")?.parentElement;
  return (pane?.classList.contains("mosaic-pane") && pane.dataset.mode) || tileId;
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
  if (!isLoadFailed(state)) loadRetry.delete(tileId);
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
  loadRetry.delete(tileId);
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
  // #216: a failed pack load's notice comes down; the load reruns when the context is back.
  if (prev && isLoadFailed(prev.state) && loadRetry.has(tileId)) removeStateNotice(viewStateTileEl(tileId));
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
  const rerun = isLoadFailed(back) ? loadRetry.get(tileId) : undefined;
  loadRetry.delete(tileId);
  // A notice asked for while the context was lost shows now (a failed load reruns instead).
  if (!rerun) under?.paint?.();
  stampViewState(tileId);
  notify(tileId);
  // #216: the pack load that failed under the lost context runs again, once (its notice's Retry).
  rerun?.();
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
  const paint = el && (state.kind === "needs-you" || state.kind === "couldnt-start") ? () => {
    const copy = viewStateCopy(state, viewName, viewStateTile(tileId, el));
    const onAction = copy.action === "review" ? actions.onReview : copy.action === "retry" ? actions.onRetry : undefined;
    paintPackAssetPaneNotice(el, copy.text, "fail", onAction
      ? { showRetry: true, onRetry: onAction, retryLabel: copy.button ?? undefined, retryAction: copy.action ?? undefined, onRetryFocused: actions.onActionFocused }
      : undefined);
  } : undefined;
  const cur = tiles.get(tileId);
  if (cur && holdsContextLost(cur.state) && !holdsContextLost(state)) {
    // #216: the tile already says it can't draw. Its notice waits with the held state (one message).
    setViewState(tileId, viewId, state, el);
    const held = heldUnderContextLost.get(tileId);
    if (held && paint) heldUnderContextLost.set(tileId, { ...held, paint });
  } else {
    paint?.();
    setViewState(tileId, viewId, state, el);
  }
  if (isLoadFailed(state) && actions.onRetry) loadRetry.set(tileId, actions.onRetry);
}

/** Tiles only: host listeners registered at module load stay. */
export function resetViewStatesForTests(): void {
  tiles.clear();
  heldUnderContextLost.clear();
  loadRetry.clear();
  tileEl = defaultTileEl;
}
