import { NetScene, type DreamAnim, type Filters, type HeroPos, type MosaicSize } from "./scene";
import type { RenderHost } from "./render-host";
import { allModes, modeById, viewCaption, type ViewMode } from "../core/modes";
import { lookForMode, mergeLook } from "../plugins/plugin";
import type { Device, StateMsg } from "../core/types";
import { applyPaneChrome, takeTheme, type Theme } from "../core/themes";
import {
  assignTiles, clampRatio, closeLeaf, defaultTree, leafIds, parseMosaicNode,
  parseMosaicTiles, structureKey, swapLeaves, type MosaicDir, type MosaicNode,
} from "./mosaic-layout";

export { centerSplit } from "./mosaic-layout";

/** Wall palette for every tile, or the next unused theme (plugin look wins when free). */
export function mosaicTileTheme(shared: boolean, wall: Theme, used: Set<string>, prefer?: string | null): Theme {
  if (shared) return wall;
  return takeTheme(used, prefer);
}

export function mosaicIds(size: MosaicSize, prefer?: string, hero: HeroPos = "off"): string[] {
  if (size === "off") return [];
  const n = Number(size);
  const pool = panePool();
  if (hero === "off") {
    const ids = pool.slice(0, n);
    if (!prefer || !pool.includes(prefer)) return ids;
    if (ids[0] === prefer) return ids;
    if (ids.includes(prefer)) return [prefer, ...ids.filter((id) => id !== prefer)];
    return [prefer, ...ids.slice(0, n - 1)];
  }
  const heroId = prefer && pool.includes(prefer) ? prefer : pool[0]!;
  return [heroId, ...pool.filter((id) => id !== heroId).slice(0, n)];
}

function panePool(): string[] {
  return allModes().map((m) => m.id);
}

function isGraph(id: string): boolean {
  const m = allModes().find((row) => row.id === id);
  return !!m && !m.standalone;
}

function arcadeKey(id: string): string {
  return modeById(id).arcadeId ?? id;
}

interface ArcadeSlot {
  view: { start(preferIp?: string | null): void; stop(): void; update(m: StateMsg): void; setTheme(t: Theme): void };
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
  private focused = "";
  private mainId = "";
  private tree: MosaicNode | null = null;
  private maximized: string | null = null;
  private splits = new Map<string, HTMLElement>();

  constructor(private cfg: {
    wall: HTMLElement;
    sceneEl: HTMLElement;
    main: NetScene;
    host?: RenderHost;
    arcade: Record<string, ArcadeSlot>;
    optsFor: (m: ViewMode) => Record<string, string>;
    onFocus: (id: string) => void;
    onPromote: (id: string, theme: Theme | null) => void;
    onLayout: (patch: MosaicLayoutPatch) => void;
    onCloseLast: () => void;
    sync: () => MosaicSync;
  }) {}

  get on(): boolean { return this.size !== "off"; }
  get current(): MosaicSize { return this.size; }
  get heroPos(): HeroPos { return this.hero; }
  get heroMode(): string { return this.heroId; }
  get focusedId(): string { return this.focused; }
  get tileIds(): string[] { return this.tree ? leafIds(this.tree) : []; }
  get layout(): MosaicLayoutPatch {
    return { tree: this.tree, maximized: this.maximized, tiles: this.tileIds };
  }
  get layoutKey(): string {
    return `${this.size}:${this.hero}:${this.tileIds.join(",")}:${this.maximized ?? ""}`;
  }
  get graphs(): NetScene[] { return [this.cfg.main, ...this.extras.map((e) => e.scene)]; }

  paneTheme(id: string): Theme | null { return this.themes.get(id) ?? null; }

  graphScene(id: string): NetScene | null {
    if (this.mainId === id || this.cfg.main.currentMode.id === id) return this.cfg.main;
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
      tree = tiles.length ? assignTiles(parsed, tiles) : parsed;
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
      && this.panes.size === ids.length;
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
    this.syncPanes(ids);
    this.placeTree();
    void this.cfg.wall.offsetHeight;
    this.applyLooks(this.cfg.sync().anim);
    this.paintPanes(this.cfg.sync().theme);
    this.syncCompactLabels();
    this.relayoutAll();
    requestAnimationFrame(() => this.relayoutAll());
    this.focus(prefer && this.panes.has(prefer) ? prefer : ids[0] ?? "");
    this.emitLayout();
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
  }

  applyLooks(a: DreamAnim, pin = true): void {
    if (!pin) {
      this.cfg.main.setAnim(a);
      for (const e of this.extras) e.scene.setAnim(a);
      return;
    }
    this.cfg.main.setAnim(mergeLook(a, lookForMode(this.mainId || this.cfg.main.currentMode.id)));
    for (const e of this.extras) e.scene.setAnim(mergeLook(a, lookForMode(e.id)));
  }

  setTheme(t: Theme, fade = false): void {
    this.paintPanes(t, fade);
  }

  teardownArcadeExcept(keep: string | null): void {
    for (const id of this.liveArcade) {
      if (id === keep) continue;
      const slot = this.cfg.arcade[arcadeKey(id)];
      if (!slot) continue;
      slot.view.stop();
      slot.el.hidden = true;
      slot.el.classList.remove("mosaic-live");
    }
    this.liveArcade.clear();
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
    const next = assignTiles(this.tree, tiles);
    if (structureKey(next) === structureKey(this.tree)) return;
    this.tree = next;
    this.syncPanes(leafIds(next));
    this.placeTree();
    this.applyLooks(this.cfg.sync().anim);
    this.paintPanes(this.cfg.sync().theme);
    this.relayoutAll();
    this.emitLayout();
  }

  private emitLayout(): void {
    this.cfg.onLayout({ tree: this.tree, maximized: this.maximized, tiles: this.tileIds });
  }

  private syncCompactLabels(): void {
    const tile = this.hero === "off" || this.heroId !== this.cfg.main.currentMode.id;
    this.cfg.main.setCompactLabels(tile);
  }

  private relayoutAll(): void {
    this.cfg.main.relayout();
    for (const e of this.extras) e.scene.relayout();
    this.cfg.host?.invalidate();
  }

  private syncPanes(ids: string[]): void {
    for (const id of [...this.panes.keys()]) {
      if (!ids.includes(id)) this.dropPane(id);
    }
    for (const id of ids) this.ensurePane(id);
  }

  private ensurePane(id: string): HTMLElement {
    const existing = this.panes.get(id);
    if (existing) return existing;
    const pane = this.makePane(id, id === this.heroId);
    this.panes.set(id, pane);
    if (isGraph(id)) {
      if (this.cfg.host) pane.classList.add("glass");
      if (!this.mainId) {
        pane.appendChild(this.cfg.sceneEl);
        this.cfg.main.setMode(modeById(id), this.cfg.optsFor(modeById(id)));
        this.mainId = id;
      } else {
        const host = document.createElement("div");
        host.className = "mosaic-scene";
        pane.appendChild(host);
        const s = new NetScene(host, { satellite: true, host: this.cfg.host });
        this.applySync(s, id, this.cfg.sync());
        s.setMode(modeById(id), this.cfg.optsFor(modeById(id)));
        this.extras.push({ id, scene: s });
      }
    } else {
      const slot = this.cfg.arcade[arcadeKey(id)];
      if (slot) {
        pane.appendChild(slot.el);
        slot.el.hidden = false;
        slot.el.classList.add("mosaic-live");
        slot.view.start();
        this.liveArcade.add(id);
      }
    }
    return pane;
  }

  private dropPane(id: string): void {
    if (id === this.mainId) {
      const next = this.extras.find((e) => isGraph(e.id));
      if (next) {
        const pane = this.panes.get(next.id);
        next.scene.dispose();
        this.extras = this.extras.filter((e) => e.id !== next.id);
        pane?.querySelector(".mosaic-scene")?.remove();
        if (pane) {
          pane.appendChild(this.cfg.sceneEl);
          this.cfg.main.setMode(modeById(next.id), this.cfg.optsFor(modeById(next.id)));
        }
        this.mainId = next.id;
      } else {
        this.mainId = "";
      }
    } else {
      const extra = this.extras.find((e) => e.id === id);
      if (extra) {
        extra.scene.dispose();
        this.extras = this.extras.filter((e) => e.id !== id);
      }
      if (this.liveArcade.has(id)) {
        const slot = this.cfg.arcade[arcadeKey(id)];
        if (slot) {
          slot.view.stop();
          slot.el.hidden = true;
          slot.el.classList.remove("mosaic-live");
        }
        this.liveArcade.delete(id);
      }
    }
    this.panes.get(id)?.remove();
    this.panes.delete(id);
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

  private refreshChrome(): void {
    for (const [id, pane] of this.panes) {
      const cap = pane.querySelector(".mosaic-cap");
      if (cap) cap.textContent = viewCaption(modeById(id));
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
    pane.className = hero ? "mosaic-pane hero" : "mosaic-pane";
    pane.dataset.mode = id;
    const bar = document.createElement("div");
    bar.className = "mosaic-chrome";
    const cap = document.createElement("span");
    cap.className = "mosaic-cap";
    cap.textContent = viewCaption(modeById(id));
    cap.title = "drag to swap tiles";
    const tools = document.createElement("div");
    tools.className = "mosaic-tools";
    tools.append(
      this.toolBtn("look", "look", "use this tile's sky and colour", () => this.promote(id)),
      this.toolBtn("max", "max", "fill the wall", () => this.toggleMax(id)),
      this.toolBtn("close", "close", "close and expand the neighbour", () => this.closeTile(id)),
    );
    bar.append(cap, tools);
    this.bindDrag(cap, id);
    pane.appendChild(bar);
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

  private bindDrag(handle: HTMLElement, id: string): void {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      const ghost = document.createElement("div");
      ghost.className = "mosaic-ghost";
      ghost.textContent = viewCaption(modeById(id));
      const onMove = (ev: PointerEvent) => {
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        if (!dragging) {
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
    });
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
    s.setFilters(st.filters);
    s.setNodeFilter(st.nodeFilter);
    s.setAnim(mergeLook(st.anim, lookForMode(id)));
    s.setDream(st.dreaming);
    s.setAliasMap(st.aliasMap);
    s.onSelect = this.cfg.main.onSelect;
    if (st.lastMsg) s.update(st.lastMsg);
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
      this.cfg.arcade[arcadeKey(id)]?.view.setTheme(t);
      this.tintPane(id, t);
    }
  }

  private tintPane(id: string, t: Theme): void {
    this.themes.set(id, t);
    const el = this.panes.get(id);
    if (el) applyPaneChrome(el, t);
  }

  private teardown(): void {
    for (const e of this.extras) e.scene.dispose();
    this.extras = [];
    for (const id of this.liveArcade) {
      const slot = this.cfg.arcade[arcadeKey(id)];
      if (!slot) continue;
      slot.view.stop();
      slot.el.hidden = true;
      slot.el.classList.remove("mosaic-live");
    }
    this.liveArcade.clear();
    this.panes.clear();
    this.themes.clear();
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
