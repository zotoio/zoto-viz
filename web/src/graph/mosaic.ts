import { NetScene, type DreamAnim, type Filters, type HeroPos, type MosaicSize, type SceneOpts } from "./scene";
import type { RenderHost } from "./render-host";

export function mosaicSceneOpts(id: string, host: RenderHost): SceneOpts {
  return { satellite: true, host, tileId: id };
}
import { allModes, arcadeSlotFor, hostEngine, modeById, viewCaption, type ViewMode } from "../core/modes";
import { usesFullDeviceTable } from "./layout-budget";
import type { Device, StateMsg } from "../core/types";
import { applyPaneChrome, takeTheme, type Theme } from "../core/themes";
import { cycleSkyPool, type BackdropKind } from "./backdrop";
import {
  inspectPaneStartup, nextGraphTile, nextHostSky, paneRecovery,
} from "./pane-health";
import {
  assignTiles, clampRatio, closeLeaf, defaultTree, leafIds, mosaicPaneIdsWithViewChange, nextPaneTiles, nextPaneTilesForPicker, parseMosaicNode,
  parseMosaicTiles, structureKey, swapLeaves, type MosaicDir, type MosaicNode,
} from "./mosaic-layout";
import { fillViewSelect, lookForMode, mergeLook } from "../plugins/plugin";
import { releasePanelView } from "./panel-view-lifecycle";
import { bindVizDriveElement, clearVizDrive } from "../plugins/viz-drive";
import { dropMosaicTileWriter } from "./mosaic-viz-feed";
import { syncVizTileScope } from "../plugins/viz-tile-budget";
import {
  paintPackAssetPaneNotice,
  type PackAssetPaneNoticeOpts,
} from "../plugins/pack-asset-pane-notice";
import { mosaicTileViewId } from "./mosaic-tile-id";
import { applyPackCoalesceLayout } from "./mosaic-pack-coalesce";
import type { PluginView } from "../plugins/plugin";

export { centerSplit } from "./mosaic-layout";
export { mosaicPaneIdsWithViewChange } from "./mosaic-layout";

function lookForTile(tileSlotId: string) {
  return lookForMode(mosaicTileViewId(tileSlotId));
}

/** Wall palette for every tile, or the next unused theme (plugin look wins when free). */
export function mosaicTileTheme(shared: boolean, wall: Theme, used: Set<string>, prefer?: string | null): Theme {
  if (shared) return wall;
  return takeTheme(used, prefer);
}

const SHARED_SKY = new Set<BackdropKind>(["none", "plugin", "custom", "dynamic"]);

/** Half of mosaic / dice rolls give every pane a sky no other pane has. */
export function shouldUniqueMosaicSkies(rnd: () => number = Math.random): boolean {
  return rnd() < 0.5;
}

/**
 * Distinct host skies per tile. Plugin shaders stay on `plugin` (each zip is its own picture).
 * Pins that would collide are replaced from `pool`.
 */
export function assignMosaicSkies(
  ids: string[],
  wall: BackdropKind,
  pool: readonly BackdropKind[],
  pin: (id: string) => BackdropKind | undefined = () => undefined,
): Record<string, BackdropKind> {
  const used = new Set<string>();
  const out: Record<string, BackdropKind> = {};
  const open: string[] = [];
  for (const id of ids) {
    const want = pin(id);
    if (want === "plugin") {
      out[id] = "plugin";
      used.add(`plugin:${id}`);
      continue;
    }
    if (want && !SHARED_SKY.has(want) && !used.has(want)) {
      out[id] = want;
      used.add(want);
      continue;
    }
    open.push(id);
  }
  const choices = pool.filter((k) => !SHARED_SKY.has(k));
  let wrap = 0;
  for (const id of open) {
    const pick = choices.find((k) => !used.has(k) && k !== wall) ?? choices.find((k) => !used.has(k));
    const sky = pick ?? choices[wrap % Math.max(1, choices.length)] ?? wall;
    if (pick) used.add(sky);
    else wrap += 1;
    out[id] = sky;
  }
  return out;
}

/** A plugin-sky look stays `plugin` even if a saved unique-sky plan named a host sky. */
export function pinPluginTileSkies(
  skies: Partial<Record<string, BackdropKind>>,
  ids: string[],
  existing: Record<string, BackdropKind> = {},
): Record<string, BackdropKind> {
  const out: Record<string, BackdropKind> = {};
  for (const id of ids) {
    const sky = skies[id] !== undefined ? skies[id]! : existing[id];
    if (sky !== undefined) out[id] = sky;
  }
  for (const id of ids) {
    if (lookForTile(id)?.backdrop === "plugin") out[id] = "plugin";
  }
  return out;
}

/** A view that names its own picture (plugin shader or an authored backdrop) does not follow the wall sky. */
export function authoredTileSky(id: string): BackdropKind | undefined {
  const backdrop = lookForTile(id)?.backdrop;
  if (!backdrop || backdrop === "none" || backdrop === "custom" || backdrop === "dynamic") return undefined;
  return backdrop;
}

export function mosaicAnimForTile(
  wall: DreamAnim,
  id: string,
  tileSky?: BackdropKind,
  pinLook = true,
): DreamAnim {
  const look = lookForTile(id);
  const merged = pinLook ? mergeLook(wall, look) : { ...wall };
  const authored = authoredTileSky(id);
  if (authored) return { ...merged, backdrop: authored };
  if (tileSky) return { ...merged, backdrop: tileSky };
  return merged;
}

/** A wall may run one full-device force layout. Further slots are stage-only or sliced graphs. */
export function limitFullDeviceTiles(ids: readonly string[], pool: readonly string[]): string[] {
  const want = ids.length;
  const out: string[] = [];
  const used = new Set<string>();
  let full = 0;
  const consider = (id: string) => {
    if (!id || out.length >= want || used.has(id)) return;
    const heavy = usesFullDeviceTable(mosaicPaneMode(id));
    if (heavy && full >= 1) return;
    if (heavy) full += 1;
    used.add(id);
    out.push(id);
  };
  for (const id of ids) consider(id);
  for (const id of pool) consider(id);
  return out;
}

export function mosaicIds(size: MosaicSize, prefer?: string, hero: HeroPos = "off"): string[] {
  if (size === "off") return [];
  const n = Number(size);
  const pool = panePool();
  let ids: string[];
  if (hero === "off") {
    ids = pool.slice(0, n);
    if (prefer && pool.includes(prefer)) {
      if (ids[0] !== prefer) {
        ids = ids.includes(prefer)
          ? [prefer, ...ids.filter((id) => id !== prefer)]
          : [prefer, ...ids.slice(0, n - 1)];
      }
    }
  } else {
    const heroId = prefer && pool.includes(prefer) ? prefer : pool[0]!;
    ids = heroId ? [heroId, ...pool.filter((id) => id !== heroId).slice(0, n)] : [];
  }
  return limitFullDeviceTiles(ids, pool);
}

/**
 * Boot / profile may persist mosaicTree without mosaicTiles. Refresh leaf ids from
 * `mosaicIds` when counts match so tile 0 shows the primary (prefer) pack view.
 */
export function mosaicBootLeafIds(
  size: MosaicSize,
  prefer: string | undefined,
  hero: HeroPos,
  explicitTiles: readonly string[],
  parsedLeafIds: readonly string[],
): string[] | null {
  if (explicitTiles.length) return null;
  const fresh = mosaicIds(size, prefer, hero);
  if (!fresh.length || !parsedLeafIds.length || fresh.length !== parsedLeafIds.length) return null;
  return fresh;
}

export function assignParsedMosaicTree(
  parsed: MosaicNode,
  size: MosaicSize,
  prefer?: string,
  hero: HeroPos = "off",
  explicitTiles: readonly string[] = [],
): MosaicNode {
  const cur = leafIds(parsed);
  const tiles = parseMosaicTiles(explicitTiles);
  const bootIds = mosaicBootLeafIds(size, prefer, hero, tiles, cur);
  return assignTiles(parsed, tiles.length ? tiles : bootIds ?? cur);
}

/** Graphs first so a dice / new wall is not mostly empty stills or arcade stages. */
export function mosaicPanePool(): string[] {
  const modes = allModes();
  return [
    ...modes.filter((m) => !m.standalone).map((m) => m.id),
    ...modes.filter((m) => m.standalone).map((m) => m.id),
  ];
}

function panePool(): string[] {
  return mosaicPanePool();
}

/**
 * Resolve a mosaic tile to a graph/arcade mode. Catalog rows win; if the menu
 * has not loaded yet, fall back to the host engine (`plugin:memory` → `memory`)
 * so a SYS wall still mounts NetScenes instead of chrome-only panes.
 */
export function mosaicPaneMode(tileSlotId: string): ViewMode {
  const viewId = mosaicTileViewId(tileSlotId);
  const catalog = allModes().find((row) => row.id === viewId);
  if (catalog) return catalog;
  const raw = viewId.startsWith("plugin:") ? viewId.slice("plugin:".length) : viewId;
  return hostEngine(raw) ?? hostEngine(viewId) ?? modeById(viewId);
}

export function mosaicIsGraph(id: string): boolean {
  return !mosaicPaneMode(id).standalone;
}

function isGraph(id: string): boolean {
  return mosaicIsGraph(id);
}

function arcadeKey(id: string): string {
  return arcadeSlotFor(mosaicPaneMode(id)) ?? mosaicPaneMode(id).arcadeId ?? id;
}

/** Chrome / Alt picks the tile up; a body drag picks up once the pointer is over another tile. */
export function mosaicShouldLift(
  kind: "chrome" | "alt" | "body",
  overId: string | null,
  sourceId: string,
): boolean {
  if (kind === "chrome" || kind === "alt") return true;
  return !!overId && overId !== sourceId;
}

interface ArcadeSlot {
  view: {
    start(preferIp?: string | null): void;
    stop(): void;
    update(m: StateMsg): void;
    setTheme(t: Theme): void;
    setBind?(bind: Record<string, string>): void;
  };
  el: HTMLElement;
}

export interface MosaicSync {
  theme: Theme;
  filters: Partial<Filters>;
  anim: DreamAnim;
  dreaming: boolean;
  nodeFilter: (d: Device) => boolean;
  lastMsg: StateMsg | null;
  aliasMap: Map<string, string>;
}

export interface MosaicLayoutPatch {
  tree: MosaicNode | null;
  maximized: string | null;
  tiles: string[];
  uniqueSkies?: boolean;
  skies?: Record<string, BackdropKind>;
}

/**
 * Simultaneous view wall. A split tree (not a fixed CSS grid) so tiles can be
 * rearranged, closed (neighbour expands), maximised, and edge-resized.
 */
export class Mosaic {
  private size: MosaicSize = "off";
  private hero: HeroPos = "off";
  private heroId = "";
  private extras: { id: string; scene: NetScene }[] = [];
  private panes = new Map<string, HTMLElement>();
  private themes = new Map<string, Theme>();
  private liveArcade = new Set<string>();
  private tileArcade = new Map<string, ArcadeSlot>();
  private focused = "";
  private mainId = "";
  private tree: MosaicNode | null = null;
  private maximized: string | null = null;
  private splits = new Map<string, HTMLElement>();
  private tileSkies = new Map<string, BackdropKind>();
  private rematchTried = new Set<string>();
  private rematchQueued = new Set<string>();
  private skyPending = new Set<string>();
  private recoveredSkies = new Map<string, BackdropKind>();

  constructor(private cfg: {
    wall: HTMLElement;
    sceneEl: HTMLElement;
    main: NetScene;
    host?: RenderHost;
    arcade: Record<string, ArcadeSlot>;
    spawnArcade?: (engine: string) => ArcadeSlot | null;
    optsFor: (m: ViewMode) => Record<string, string>;
    onFocus: (id: string) => void;
    onPromote: (id: string, theme: Theme | null) => void;
    onLayout: (patch: MosaicLayoutPatch) => void;
    onCloseLast: () => void;
    /** Live tile picker (consent, setMode, sky sync). When set, pane chrome uses this instead of bare assignViews. */
    onPanePick?: (fromId: string, toId: string) => boolean | Promise<boolean>;
    paneCog?: (id: string) => HTMLButtonElement;
    /** One-shot roll of a new view onto this pane. Sits beside the corner cog. */
    paneDice?: (id: string) => HTMLButtonElement;
    sync: () => MosaicSync;
    testHooks?: {
      onSkyHold?: (id: string) => void;
      onModeRefresh?: (id: string) => void;
      onPaneAuditBind?: (id: string) => void;
      onPaneRebind?: (id: string) => void;
    };
    pluginSpecForMode?: (modeId: string) => PluginView | null;
    /** Picker label suffix, e.g. " (full view only)" for sandboxed packs a pane can only preview. */
    pickSuffix?: (modeId: string) => string;
  }) {}

  private fillPanePick(pick: HTMLSelectElement, id: string): void {
    fillViewSelect(pick, id, this.cfg.pickSuffix);
  }

  /**
   * Bottom caption on panes that can only preview their pack (no sandbox frame). The button
   * does what the tile's max does: fill the wall and make it the live view.
   */
  syncPreviewCaptions(previewOnly: (id: string) => boolean): void {
    for (const [id, pane] of this.panes) {
      const on = this.on && previewOnly(id);
      const existing = pane.querySelector(".mosaic-pane-preview-caption");
      if (!on) {
        existing?.remove();
        continue;
      }
      if (existing) continue;
      const el = document.createElement("div");
      el.className = "mosaic-pane-preview-caption";
      const label = document.createElement("span");
      label.textContent = "Preview only · ";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mosaic-pane-preview-open";
      btn.textContent = "Open full view";
      btn.addEventListener("pointerdown", (e) => e.stopPropagation());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const cur = [...this.panes.entries()].find(([, p]) => p === pane)?.[0] ?? id;
        if (this.maximized === cur) this.promote(cur);
        else this.toggleMax(cur);
      });
      el.append(label, btn);
      pane.appendChild(el);
    }
  }

  private syncPackCoalesce(): void {
    applyPackCoalesceLayout(this, mosaicPaneMode, this.cfg.pluginSpecForMode);
  }

  get on(): boolean { return this.size !== "off"; }
  get current(): MosaicSize { return this.size; }
  get heroPos(): HeroPos { return this.hero; }
  get heroMode(): string { return this.heroId; }
  get focusedId(): string { return this.focused; }
  get mainMode(): string { return this.mainId; }
  get mainTileId(): string { return this.mainId; }
  get tileIds(): string[] { return this.tree ? leafIds(this.tree) : []; }
  /** Live pane elements, in tile order. */
  get paneElements(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const id of this.tileIds) {
      const pane = this.panes.get(id);
      if (pane) out.push(pane);
    }
    return out;
  }
  get layout(): MosaicLayoutPatch {
    const share = this.skyShare();
    return {
      tree: this.tree,
      maximized: this.maximized,
      tiles: this.tileIds,
      uniqueSkies: share.unique,
      skies: share.skies,
    };
  }

  paneSky(id: string): BackdropKind | undefined {
    return this.tileSkies.get(id);
  }
  get layoutKey(): string {
    return `${this.size}:${this.hero}:${this.tileIds.join(",")}:${this.maximized ?? ""}`;
  }
  get graphs(): NetScene[] { return [this.cfg.main, ...this.extras.map((e) => e.scene)]; }

  paneTheme(id: string): Theme | null { return this.themes.get(id) ?? null; }

  graphScene(id: string): NetScene | null {
    if (this.mainId === id) return this.cfg.main;
    return this.extras.find((e) => e.id === id)?.scene ?? null;
  }

  private restoreSolo(): void {
    this.size = "off";
    this.hero = "off";
    this.heroId = "";
    this.mainId = "";
    this.tree = null;
    this.maximized = null;
    document.body.classList.remove("mosaic");
    document.body.dataset.mosaic = "off";
    document.body.dataset.hero = "off";
    delete document.body.dataset.mosaicMax;
    this.cfg.main.setCompactLabels(false);
    this.cfg.wall.append(this.cfg.sceneEl, ...Object.values(this.cfg.arcade).map((a) => a.el));
    this.cfg.host?.invalidate();
  }

  setSize(
    size: MosaicSize,
    prefer?: string,
    hero: HeroPos = "off",
    stored?: { tree?: MosaicNode | null; maximized?: string | null; tiles?: string[] },
  ): void {
    if (size === "off") {
      this.teardown();
      this.restoreSolo();
      return;
    }
    const tiles = parseMosaicTiles(stored?.tiles);
    let parsed = parseMosaicNode(stored?.tree);
    const preset = Number(size);
    // A leftover tree from another preset (or a center-hero wall) should not
    // survive a size chip / MCP size change unless the operator already closed
    // tiles (leaf count below the preset) or sent mosaicTiles.
    if (
      parsed
      && this.size !== size
      && Number.isFinite(preset)
      && leafIds(parsed).length > preset
      && !tiles.length
    ) {
      parsed = null;
    }
    let tree: MosaicNode | null = null;
    if (parsed && leafIds(parsed).some(Boolean)) {
      tree = assignParsedMosaicTree(parsed, size, prefer, hero, tiles);
    } else {
      const ids = tiles.length ? tiles : mosaicIds(size, prefer, hero);
      tree = defaultTree(ids, hero);
    }
    if (!tree || !leafIds(tree).length) {
      this.teardown();
      this.restoreSolo();
      return;
    }
    const ids = leafIds(tree);
    const max = stored?.maximized && ids.includes(stored.maximized) ? stored.maximized : null;
    const sameWall = this.on && this.size === size && this.hero === hero
      && structureKey(this.tree) === structureKey(tree)
      && this.maximized === max
      && this.panes.size === ids.length
      && ids.filter(isGraph).every((id) => this.paneBound(id));
    this.size = size;
    this.hero = hero;
    this.heroId = hero !== "off" ? ids[0] ?? "" : "";
    this.tree = tree;
    this.maximized = max;
    document.body.classList.add("mosaic");
    document.body.dataset.mosaic = size;
    document.body.dataset.hero = this.hero;
    if (max) document.body.dataset.mosaicMax = max;
    else delete document.body.dataset.mosaicMax;
    if (sameWall) {
      this.placeTree();
      this.relayoutAll();
      return;
    }
    this.rematchTried.clear();
    this.rematchQueued.clear();
    this.recoveredSkies.clear();
    this.syncPanes(ids);
    this.placeTree();
    void this.cfg.wall.offsetHeight;
    this.ingestSkyPlan(this.cfg.sync().anim);
    this.applyLooks(this.cfg.sync().anim);
    this.paintPanes(this.cfg.sync().theme);
    this.syncCompactLabels();
    this.relayoutAll();
    requestAnimationFrame(() => this.relayoutAll());
    this.focus(prefer && this.panes.has(prefer) ? prefer : ids[0] ?? "");
    this.refreshPaneModes();
    this.flushSync();
    this.holdPluginSkies();
    this.auditPanes("bind");
    this.emitLayout();
  }

  /** Attach missing graph scenes and restyle from the catalog (empty panes after a pre-catalog setSize). */
  hydrate(): void {
    if (!this.on || !this.tree) return;
    this.syncPanes(leafIds(this.tree));
    this.refreshPaneModes();
    this.placeTree();
    this.relayoutAll();
    this.flushSync();
    this.holdPluginSkies();
    this.auditPanes("bind");
    this.cfg.host?.invalidate();
  }

  /** Plugin skies are in flight — do not treat a missing shader as a failed sky yet. */
  markSkyPending(): void {
    this.skyPending = new Set(this.tileIds);
    for (const id of this.tileIds) this.panes.get(id)?.classList.add("warming");
  }

  /** After shader fetch/compile: recover blank tiles instead of leaving a black plugin stage. */
  settlePanes(): void {
    this.skyPending.clear();
    this.auditPanes("settle");
  }

  focus(id: string): void {
    this.focused = id;
    for (const [mid, pane] of this.panes) pane.classList.toggle("focus", mid === id);
  }

  eachGraph(fn: (s: NetScene) => void): void {
    for (const s of this.graphs) fn(s);
  }

  update(msg: StateMsg): void {
    for (const e of this.extras) e.scene.update(msg);
    for (const slot of this.tileArcade.values()) slot.view.update(msg);
  }

  applyLooks(a: DreamAnim, pin = true): void {
    this.ingestSkyPlan(a);
    const mainId = this.mainId || this.cfg.main.currentMode.id;
    this.cfg.main.setAnim(this.animFor(mainId, a, pin));
    for (const e of this.extras) e.scene.setAnim(this.animFor(e.id, a, pin));
  }

  setTheme(t: Theme, fade = false): void {
    this.paintPanes(t, fade);
  }

  teardownArcadeExcept(keep: string | null): void {
    for (const id of [...this.liveArcade]) {
      if (id === keep) continue;
      this.releaseArcade(id);
    }
    if (keep) this.liveArcade.add(keep);
  }

  closeTile(id: string): void {
    if (!this.tree || !this.on) return;
    const next = closeLeaf(this.tree, id);
    if (!next) {
      this.teardown();
      this.restoreSolo();
      this.cfg.onCloseLast();
      return;
    }
    const max = this.maximized === id ? null : this.maximized;
    this.tree = next;
    this.maximized = max && leafIds(next).includes(max) ? max : null;
    this.syncPanes(leafIds(next));
    this.placeTree();
    this.paintPanes(this.cfg.sync().theme);
    this.relayoutAll();
    this.emitLayout();
  }

  toggleMax(id: string): void {
    if (!this.panes.has(id)) return;
    this.maximized = this.maximized === id ? null : id;
    if (this.maximized) document.body.dataset.mosaicMax = this.maximized;
    else delete document.body.dataset.mosaicMax;
    this.placeTree();
    this.relayoutAll();
    this.emitLayout();
    if (this.maximized) {
      this.focus(id);
      this.cfg.onPromote(id, this.paneTheme(id));
    }
  }

  promote(id: string): void {
    this.focus(id);
    this.cfg.onPromote(id, this.paneTheme(id));
  }

  assignViews(tiles: string[]): void {
    if (!this.tree) return;
    const prev = this.tileIds.slice();
    const want = parseMosaicTiles(tiles);
    if (want.join("\0") === prev.join("\0")) return;
    const touch = new Set(mosaicPaneIdsWithViewChange(prev, want));
    this.tree = assignTiles(this.tree, want);
    this.rematchTried.clear();
    this.rematchQueued.clear();
    this.syncPanes(this.tileIds, touch);
    this.placeTree();
    this.applyLooks(this.cfg.sync().anim);
    this.paintPanes(this.cfg.sync().theme);
    this.refreshPaneModes(touch);
    this.holdPluginSkies(touch);
    this.auditPanes("bind", touch);
    this.relayoutAll();
    this.emitLayout();
  }

  /** Change one pane. A view already on the wall is copied onto this pane; the others stay. */
  setPaneView(fromId: string, toId: string): boolean {
    return this.applyPaneTileList(fromId, toId, nextPaneTiles(this.tileIds, fromId, toId));
  }

  /** Settings mosaic slot picker: duplicate pack tiles when the view is already on the wall. */
  setPaneViewFromPicker(fromId: string, toId: string): boolean {
    return this.applyPaneTileList(fromId, toId, nextPaneTilesForPicker(this.tileIds, fromId, toId));
  }

  private applyPaneTileList(fromId: string, toId: string, next: string[]): boolean {
    if (!this.tree || !toId || fromId === toId) return false;
    if (next.join("\0") === this.tileIds.join("\0")) return false;
    if (!next.includes(fromId)) releasePanelView(fromId);
    this.assignViews(next);
    return true;
  }

  /** Inline consent / error copy over the tile (never a silent dark pane). */
  setPaneNotice(
    id: string,
    text: string | null | undefined,
    recipe: "default" | "fail" | "reconnecting" = "default",
    opts?: PackAssetPaneNoticeOpts,
  ): void {
    const pane = this.panes.get(id);
    if (!pane) return;
    this.paintPaneNotice(pane, text, recipe, opts);
  }

  setWallNotice(text: string | null | undefined): void {
    const host = this.cfg.wall;
    if (!host) return;
    const existing = host.querySelector(".mosaic-wall-notice");
    if (!text) {
      existing?.remove();
      return;
    }
    const el = existing instanceof HTMLElement ? existing : document.createElement("div");
    if (!existing) {
      el.className = "mosaic-wall-notice";
      host.prepend(el);
    }
    el.textContent = text;
  }

  /** Plugin settings HUD caption for this tile (bottom of frame). */
  setPaneSettingsCaption(id: string, text: string | null | undefined): void {
    const pane = this.panes.get(id);
    if (!pane) return;
    this.paintPaneSettingsCaption(pane, text);
  }

  private paintPaneSettingsCaption(pane: HTMLElement, text: string | null | undefined): void {
    const existing = pane.querySelector(".mosaic-pane-settings-caption");
    if (!text) {
      existing?.remove();
      return;
    }
    const el = existing instanceof HTMLElement ? existing : document.createElement("div");
    if (!existing) {
      el.className = "mosaic-pane-settings-caption";
      pane.appendChild(el);
    }
    el.textContent = text;
  }

  private paintPaneNotice(
    pane: HTMLElement,
    text: string | null | undefined,
    recipe: "default" | "fail" | "reconnecting" = "default",
    opts?: PackAssetPaneNoticeOpts,
  ): void {
    paintPackAssetPaneNotice(pane, text, recipe, opts);
  }

  /** One sky shares the wall image. Distinct skies are an explicit choice, not "more than one entry in the map". */
  private skyShare(): { unique: boolean; skies: Record<string, BackdropKind> } {
    const unique = this.cfg.sync().anim.mosaicUniqueSkies !== false;
    return {
      unique,
      skies: unique ? Object.fromEntries(this.tileSkies) : {},
    };
  }

  private emitLayout(): void {
    const share = this.skyShare();
    this.cfg.onLayout({
      tree: this.tree,
      maximized: this.maximized,
      tiles: this.tileIds,
      uniqueSkies: share.unique,
      skies: share.skies,
    });
  }

  private syncCompactLabels(): void {
    const tile = this.hero === "off" || this.heroId !== this.cfg.main.currentMode.id;
    this.cfg.main.setCompactLabels(tile);
  }

  private relayoutAll(): void {
    this.cfg.main.relayout();
    for (const e of this.extras) e.scene.refit();
    this.cfg.host?.invalidate();
  }

  private syncPanes(ids: string[], touchIds?: ReadonlySet<string>): void {
    for (const id of [...this.panes.keys()]) {
      if (!ids.includes(id)) this.dropPane(id);
    }
    for (const id of ids) {
      if (this.panes.has(id) && touchIds && !touchIds.has(id)) continue;
      this.ensurePane(id);
    }
    syncVizTileScope(ids.length ? ids : ["main"]);
  }

  private paneBound(id: string): boolean {
    if (this.mainId === id) return true;
    if (this.extras.some((e) => e.id === id)) return true;
    return this.liveArcade.has(id);
  }

  private flushSync(): void {
    const msg = this.cfg.sync().lastMsg;
    if (msg) this.update(msg);
  }

  /** Re-apply compiled catalog modes so extras created as host stubs pick up graphBase. */
  private refreshPaneModes(only?: ReadonlySet<string>): void {
    if (this.mainId && (!only || only.has(this.mainId))) {
      const m = mosaicPaneMode(this.mainId);
      this.cfg.main.setMode(m, this.cfg.optsFor(m));
      this.cfg.testHooks?.onModeRefresh?.(this.mainId);
    }
    for (const e of this.extras) {
      if (only && !only.has(e.id)) continue;
      const m = mosaicPaneMode(e.id);
      e.scene.setMode(m, this.cfg.optsFor(m));
      this.cfg.testHooks?.onModeRefresh?.(e.id);
    }
  }

  private ensurePane(id: string): HTMLElement {
    let pane = this.panes.get(id);
    if (!pane) {
      pane = this.makePane(id, id === this.heroId);
      this.panes.set(id, pane);
    }
    this.bindPaneView(pane, id);
    return pane;
  }

  private bindPaneView(pane: HTMLElement, id: string): void {
    this.cfg.testHooks?.onPaneRebind?.(id);
    pane.classList.add("warming");
    if (this.mainId === id && this.cfg.sceneEl.parentElement !== pane) {
      pane.appendChild(this.cfg.sceneEl);
    }
    if (this.paneBound(id)) {
      this.holdPluginSkies(new Set([id]));
      this.auditPane(id, "bind");
      return;
    }
    if (isGraph(id)) {
      if (this.cfg.host) pane.classList.add("glass");
      if (!this.mainId) {
        pane.appendChild(this.cfg.sceneEl);
        const m = mosaicPaneMode(id);
        this.cfg.main.setMode(m, this.cfg.optsFor(m));
        this.cfg.main.retargetPanel(id);
        this.mainId = id;
      } else {
        const host = pane.querySelector<HTMLElement>(":scope > .mosaic-scene")
          ?? Object.assign(document.createElement("div"), { className: "mosaic-scene" });
        if (!host.parentElement) pane.appendChild(host);
        const s = new NetScene(host, mosaicSceneOpts(id, this.cfg.host!));
        this.applySync(s, id, this.cfg.sync());
        const m = mosaicPaneMode(id);
        s.setMode(m, this.cfg.optsFor(m));
        this.extras.push({ id, scene: s });
      }
      this.holdPluginSkies(new Set([id]));
      this.auditPane(id, "bind");
      return;
    }
    const slot = this.ensureArcade(id);
    if (!slot) {
      this.auditPane(id, "bind");
      return;
    }
    pane.appendChild(slot.el);
    slot.el.hidden = false;
    slot.el.classList.add("mosaic-live");
    const bind = this.cfg.optsFor(mosaicPaneMode(id));
    slot.view.setBind?.(bind);
    slot.view.start();
    const msg = this.cfg.sync().lastMsg;
    if (msg) slot.view.update(msg);
    this.liveArcade.add(id);
    this.auditPane(id, "bind");
  }

  /** Keep plugin tiles warming until settlePanes so bind does not swap them to a host sky. */
  private holdPluginSkies(only?: ReadonlySet<string>): void {
    for (const id of this.tileIds) {
      if (only && !only.has(id)) continue;
      if (!this.paneSnap(id).pluginSkyWanted) continue;
      this.skyPending.add(id);
      this.panes.get(id)?.classList.add("warming");
      this.cfg.testHooks?.onSkyHold?.(id);
    }
  }

  private auditPanes(phase: "bind" | "settle", only?: ReadonlySet<string>): void {
    for (const id of [...this.tileIds]) {
      if (only && !only.has(id)) continue;
      this.auditPane(id, phase);
    }
  }

  private paneSnap(id: string) {
    const graph = this.graphScene(id);
    const bound = this.paneBound(id);
    const look = lookForTile(id);
    const tileSky = this.tileSkies.get(id);
    return {
      id,
      kind: (bound ? (this.liveArcade.has(id) ? "arcade" : "graph") : "empty") as
        "graph" | "arcade" | "empty",
      bound,
      skyPending: this.skyPending.has(id),
      stageOnly: !!(mosaicPaneMode(id).stageOnly || look?.stageOnly),
      backdrop: graph?.dreamAnim.backdrop ?? tileSky ?? look?.backdrop ?? "",
      pluginSkyId: graph?.pluginSkyId ?? null,
      pluginSkyWanted: tileSky === "plugin" || look?.backdrop === "plugin",
      nodes: graph?.nodeCount ?? 0,
      hasSnapshot: !!this.cfg.sync().lastMsg,
    };
  }

  private auditPane(id: string, phase: "bind" | "settle"): void {
    const pane = this.panes.get(id);
    if (!pane || !this.on) return;
    if (phase === "bind") this.cfg.testHooks?.onPaneAuditBind?.(id);
    const fault = inspectPaneStartup(this.paneSnap(id));
    pane.dataset.fault = fault ?? "";
    if (!fault) {
      pane.classList.remove("warming");
      return;
    }
    if (phase === "bind" && fault !== "unbound") return;
    const plan = paneRecovery(fault);
    if (plan.flush) this.flushSync();
    if (!inspectPaneStartup(this.paneSnap(id))) {
      pane.classList.remove("warming");
      pane.dataset.fault = "";
      return;
    }
    if (plan.hostSky) {
      this.fallbackHostSky(id);
      pane.classList.remove("warming");
      pane.dataset.fault = inspectPaneStartup(this.paneSnap(id)) ?? "";
      return;
    }
    if (plan.rematch) {
      this.queueRematch(id);
      return;
    }
  }

  private queueRematch(id: string): void {
    if (this.rematchTried.has(id) || this.rematchQueued.has(id)) return;
    this.rematchQueued.add(id);
    queueMicrotask(() => {
      this.rematchQueued.delete(id);
      this.rematchPane(id);
    });
  }

  private rematchPane(id: string): void {
    if (!this.on || !this.tree || this.rematchTried.has(id) || !this.panes.has(id)) return;
    const next = nextGraphTile(this.tileIds, mosaicPanePool(), isGraph);
    if (!next) return;
    this.rematchTried.add(id);
    this.tree = assignTiles(this.tree, this.tileIds.map((x) => (x === id ? next : x)));
    this.dropPane(id);
    this.syncPanes(leafIds(this.tree));
    this.placeTree();
    this.applyLooks(this.cfg.sync().anim);
    this.paintPanes(this.cfg.sync().theme);
    this.flushSync();
    this.relayoutAll();
    this.emitLayout();
  }

  private fallbackHostSky(id: string): void {
    const used = [...this.tileSkies.values()].filter((k) => k !== "plugin");
    const sky = nextHostSky(used, cycleSkyPool(), this.cfg.sync().anim.backdrop);
    this.recoveredSkies.set(id, sky);
    this.tileSkies.set(id, sky);
    const target = this.graphScene(id);
    if (target) target.setAnim({ ...this.animFor(id, this.cfg.sync().anim), backdrop: sky });
    this.emitLayout();
  }

  private ensureArcade(id: string): ArcadeSlot | null {
    const have = this.tileArcade.get(id);
    if (have) return have;
    const engine = arcadeKey(id);
    const slot = this.cfg.spawnArcade?.(engine) ?? null;
    if (!slot) return null;
    this.tileArcade.set(id, slot);
    return slot;
  }

  private releaseArcade(id: string): void {
    const slot = this.tileArcade.get(id);
    if (slot) {
      slot.view.stop();
      slot.el.remove();
      this.tileArcade.delete(id);
    }
    this.liveArcade.delete(id);
  }

  private dropPane(id: string): void {
    releasePanelView(id);
    dropMosaicTileWriter(id);
    if (id === this.mainId) {
      const next = this.extras.find((e) => isGraph(e.id));
      if (next) {
        const pane = this.panes.get(next.id);
        next.scene.dispose();
        this.extras = this.extras.filter((e) => e.id !== next.id);
        pane?.querySelector(".mosaic-scene")?.remove();
        if (pane) {
          pane.appendChild(this.cfg.sceneEl);
          const m = mosaicPaneMode(next.id);
          this.cfg.main.setMode(m, this.cfg.optsFor(m));
          this.cfg.main.retargetPanel(next.id);
        }
        this.mainId = next.id;
      } else {
        this.mainId = "";
        this.cfg.main.retargetPanel(null);
      }
    } else {
      const extra = this.extras.find((e) => e.id === id);
      if (extra) {
        extra.scene.dispose();
        this.extras = this.extras.filter((e) => e.id !== id);
      }
      if (this.liveArcade.has(id) || this.tileArcade.has(id)) this.releaseArcade(id);
    }
    this.panes.get(id)?.remove();
    this.panes.delete(id);
    clearVizDrive(id);
    this.themes.delete(id);
  }

  private placeTree(): void {
    this.splits.clear();
    this.cfg.wall.replaceChildren();
    if (!this.tree) return;
    if (this.maximized && this.panes.has(this.maximized)) {
      const pane = this.panes.get(this.maximized)!;
      pane.classList.add("max");
      pane.style.flex = "";
      this.cfg.wall.appendChild(pane);
      this.refreshChrome();
      return;
    }
    for (const pane of this.panes.values()) pane.classList.remove("max");
    this.cfg.wall.appendChild(this.renderNode(this.tree, ""));
    this.refreshChrome();
  }

  private renderNode(node: MosaicNode, path: string): HTMLElement {
    if (node.type === "leaf") {
      return this.panes.get(node.id) ?? this.ensurePane(node.id);
    }
    const wrap = document.createElement("div");
    wrap.className = "mosaic-split";
    wrap.dataset.dir = node.dir;
    wrap.dataset.path = path;
    const a = this.renderNode(node.a, `${path}a`);
    const b = this.renderNode(node.b, `${path}b`);
    a.style.flex = `${node.ratio} 1 0`;
    b.style.flex = `${1 - node.ratio} 1 0`;
    const handle = this.makeHandle(node.dir, path);
    wrap.append(a, handle, b);
    this.splits.set(path, wrap);
    return wrap;
  }

  private makeHandle(dir: MosaicDir, path: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "mosaic-handle";
    el.dataset.dir = dir;
    el.title = "drag to resize";
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wrap = this.splits.get(path);
      if (!wrap || !this.tree) return;
      const start = wrap.getBoundingClientRect();
      const onMove = (ev: PointerEvent) => {
        const ratio = dir === "h"
          ? (ev.clientX - start.left) / start.width
          : (ev.clientY - start.top) / start.height;
        const r = clampRatio(ratio);
        const kids = [...wrap.children] as HTMLElement[];
        const first = kids[0];
        const last = kids[kids.length - 1];
        if (first) first.style.flex = `${r} 1 0`;
        if (last) last.style.flex = `${1 - r} 1 0`;
        wrap.dataset.ratio = String(r);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const r = Number(wrap.dataset.ratio);
        if (!this.tree || !Number.isFinite(r)) return;
        this.tree = setRatioAt(this.tree, path, r);
        this.relayoutAll();
        this.emitLayout();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    });
    return el;
  }

  /** Rebuild tile view menus after the catalog or recent-pick list changes. */
  refreshViewMenus(): void {
    this.refreshChrome();
  }

  private refreshChrome(): void {
    for (const [id, pane] of this.panes) {
      const pick = pane.querySelector<HTMLSelectElement>(".mosaic-pick");
      if (pick) this.fillPanePick(pick, id);
      pane.classList.toggle("hero", this.hero !== "off" && id === this.heroId);
      pane.classList.toggle("max", this.maximized === id);
      const maxBtn = pane.querySelector<HTMLButtonElement>('[data-act="max"]');
      if (maxBtn) {
        maxBtn.textContent = this.maximized === id ? "restore" : "max";
        maxBtn.title = this.maximized === id ? "restore tiles" : "fill the wall";
      }
    }
  }

  private makePane(id: string, hero: boolean): HTMLElement {
    const pane = document.createElement("div");
    pane.className = hero ? "mosaic-pane hero warming" : "mosaic-pane warming";
    pane.dataset.mode = id;
    const bar = document.createElement("div");
    bar.className = "mosaic-chrome";
    const pick = document.createElement("select");
    pick.className = "mosaic-pick";
    pick.setAttribute("aria-label", "pane view");
    pick.title = "this pane only — other panes stay as they are";
    this.fillPanePick(pick, id);
    pick.addEventListener("pointerdown", (e) => e.stopPropagation());
    pick.addEventListener("click", (e) => e.stopPropagation());
    pick.addEventListener("change", () => {
      const fromId = [...this.panes.entries()].find(([, el]) => el === pane)?.[0] ?? id;
      const toId = pick.value;
      if (fromId === toId) return;
      if (this.cfg.onPanePick) {
        const ret = this.cfg.onPanePick(fromId, toId);
        const fail = () => this.fillPanePick(pick, fromId);
        if (ret instanceof Promise) void ret.then((ok) => { if (ok === false) fail(); });
        else if (ret === false) fail();
      } else if (!this.setPaneView(fromId, toId)) this.fillPanePick(pick, fromId);
    });
    const tools = document.createElement("div");
    tools.className = "mosaic-tools";
    tools.append(
      this.toolBtn("look", "look", "use this tile's sky and colour", () => this.promote(id)),
      this.toolBtn("max", "max", "fill the wall", () => this.toggleMax(id)),
      this.toolBtn("close", "close", "close and expand the neighbour", () => this.closeTile(id)),
    );
    bar.append(pick, tools);
    bar.title = "drag onto another tile to swap views";
    this.bindSwapHandle(bar, id, "chrome");
    this.bindPaneBodySwap(pane, id);
    pane.appendChild(bar);
    const dice = this.cfg.paneDice?.(id);
    if (dice) pane.appendChild(dice);
    const cog = this.cfg.paneCog?.(id);
    if (cog) pane.appendChild(cog);
    bindVizDriveElement(id, pane);
    return pane;
  }

  private toolBtn(act: string, label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mosaic-tool";
    b.dataset.act = act;
    b.textContent = label;
    b.title = title;
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  private bindSwapHandle(handle: HTMLElement, id: string, kind: "chrome" | "alt"): void {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".mosaic-tool, .mosaic-pick, .mosaic-pane-cog, .mosaic-pane-dice")) return;
      e.preventDefault();
      e.stopPropagation();
      this.beginSwapDrag(id, e.clientX, e.clientY, kind);
    });
  }

  /** Left-drag that leaves this tile (or Alt-drag) picks the view up to drop on another. */
  private bindPaneBodySwap(pane: HTMLElement, id: string): void {
    pane.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest(".mosaic-tool, .mosaic-handle, .mosaic-chrome, .mosaic-pane-cog, .mosaic-pane-dice")) return;
      if (e.altKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        this.beginSwapDrag(id, e.clientX, e.clientY, "alt");
        return;
      }
      const onMove = (ev: PointerEvent) => {
        const over = this.paneAt(ev.clientX, ev.clientY);
        if (!mosaicShouldLift("body", over, id)) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        t.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
        this.beginSwapDrag(id, ev.clientX, ev.clientY, "body");
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    });
  }

  private beginSwapDrag(id: string, x0: number, y0: number, kind: "chrome" | "alt" | "body"): void {
    const slop = kind === "body" ? 0 : 6;
    let dragging = kind === "body";
    const ghost = document.createElement("div");
    ghost.className = "mosaic-ghost";
    ghost.textContent = viewCaption(mosaicPaneMode(id));
    if (dragging) {
      document.body.appendChild(ghost);
      document.body.classList.add("mosaic-dragging");
      ghost.style.left = `${x0 + 8}px`;
      ghost.style.top = `${y0 + 8}px`;
      const over0 = this.paneAt(x0, y0);
      for (const [mid, pane] of this.panes) pane.classList.toggle("drop", mid === over0 && over0 !== id);
    }
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < slop) return;
      if (!dragging) {
        if (!mosaicShouldLift(kind, this.paneAt(ev.clientX, ev.clientY), id) && kind !== "chrome" && kind !== "alt") return;
        dragging = true;
        document.body.appendChild(ghost);
        document.body.classList.add("mosaic-dragging");
      }
      ghost.style.left = `${ev.clientX + 8}px`;
      ghost.style.top = `${ev.clientY + 8}px`;
      const over = this.paneAt(ev.clientX, ev.clientY);
      for (const [mid, pane] of this.panes) pane.classList.toggle("drop", mid === over && over !== id);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      ghost.remove();
      document.body.classList.remove("mosaic-dragging");
      for (const pane of this.panes.values()) pane.classList.remove("drop");
      if (!dragging || !this.tree) return;
      const over = this.paneAt(ev.clientX, ev.clientY);
      if (!over || over === id) return;
      this.tree = swapLeaves(this.tree, id, over);
      this.placeTree();
      this.relayoutAll();
      this.emitLayout();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  private paneAt(x: number, y: number): string | null {
    for (const [id, pane] of this.panes) {
      if (this.maximized && id !== this.maximized) continue;
      const r = pane.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  }

  private applySync(s: NetScene, id: string, st: MosaicSync): void {
    s.setActive(true);
    s.setFilters(st.filters);
    s.setNodeFilter(st.nodeFilter);
    s.setAnim(this.animFor(id, st.anim));
    s.setDream(st.dreaming);
    s.setAliasMap(st.aliasMap);
    s.onSelect = this.cfg.main.onSelect;
    if (st.lastMsg) s.update(st.lastMsg);
  }

  private animFor(id: string, wall: DreamAnim, pinLook = true): DreamAnim {
    return mosaicAnimForTile(wall, id, this.tileSkies.get(id), pinLook);
  }

  /** One sky is off unless it was turned on. Distinct host skies are the default. */
  private ingestSkyPlan(a: DreamAnim): void {
    if (a.mosaicUniqueSkies === false) {
      this.tileSkies.clear();
      this.applyRecoveredSkies();
      return;
    }
    const planned = a.mosaicSkies && Object.keys(a.mosaicSkies).length ? a.mosaicSkies : null;
    const ids = this.tileIds.length ? this.tileIds : Object.keys(planned ?? {});
    const rolled = assignMosaicSkies(ids, a.backdrop, cycleSkyPool(), (id) => lookForTile(id)?.backdrop);
    const next = pinPluginTileSkies(
      planned ?? rolled,
      ids,
      Object.fromEntries(this.tileSkies),
    );
    const missing = ids.filter((id) => next[id] === undefined);
    if (missing.length) {
      const filled = assignMosaicSkies(
        ids,
        a.backdrop,
        cycleSkyPool(),
        (id) => next[id] ?? lookForTile(id)?.backdrop,
      );
      for (const id of missing) if (filled[id]) next[id] = filled[id];
    }
    this.tileSkies = new Map(Object.entries(next));
    this.applyRecoveredSkies();
  }

  /** Host-sky fallbacks survive a later unique-sky / plugin pin so the tile does not go black again. */
  private applyRecoveredSkies(): void {
    for (const [id, sky] of this.recoveredSkies) {
      if (!this.tileIds.includes(id)) continue;
      if (lookForTile(id)?.backdrop === "plugin") {
        this.recoveredSkies.delete(id);
        this.tileSkies.set(id, "plugin");
        continue;
      }
      this.tileSkies.set(id, sky);
    }
  }

  private paintPanes(hero: Theme, fade = false): void {
    const shared = !!this.cfg.sync().anim.mosaicSharedTheme;
    const used = new Set<string>([hero.id]);
    const mainId = this.mainId || this.cfg.main.currentMode.id;
    this.tintPane(mainId, hero);
    for (const e of this.extras) {
      const t = mosaicTileTheme(shared, hero, used, lookForMode(e.id)?.theme);
      e.scene.setTheme(t, fade);
      this.tintPane(e.id, t);
    }
    for (const id of this.liveArcade) {
      const t = mosaicTileTheme(shared, hero, used, lookForMode(id)?.theme);
      this.tileArcade.get(id)?.view.setTheme(t);
      this.tintPane(id, t);
    }
  }

  private tintPane(id: string, t: Theme): void {
    this.themes.set(id, t);
    const el = this.panes.get(id);
    if (el) applyPaneChrome(el, t);
  }

  private teardown(): void {
    syncVizTileScope([]);
    for (const e of this.extras) e.scene.dispose();
    this.extras = [];
    for (const id of [...this.tileArcade.keys()]) this.releaseArcade(id);
    this.liveArcade.clear();
    this.panes.clear();
    this.themes.clear();
    this.tileSkies.clear();
    this.rematchTried.clear();
    this.rematchQueued.clear();
    this.recoveredSkies.clear();
    this.skyPending.clear();
    this.splits.clear();
    this.mainId = "";
    this.tree = null;
    this.maximized = null;
    this.cfg.wall.replaceChildren();
  }
}

function setRatioAt(n: MosaicNode, path: string, ratio: number): MosaicNode {
  if (n.type === "leaf") return n;
  if (!path) return { ...n, ratio: clampRatio(ratio) };
  const step = path[0];
  const rest = path.slice(1);
  if (step === "a") return { ...n, a: setRatioAt(n.a, rest, ratio) };
  if (step === "b") return { ...n, b: setRatioAt(n.b, rest, ratio) };
  return { ...n, ratio: clampRatio(ratio) };
}
