import { NetScene, type DreamAnim, type Filters, type HeroPos, type MosaicSize } from "./scene";
import { allModes, modeById, viewCaption, type ViewMode } from "../core/modes";
import { lookForMode, mergeLook } from "../plugins/plugin";
import type { Device, StateMsg } from "../core/types";
import { applyPaneChrome, takeTheme, type Theme } from "../core/themes";

/** Center-hero split of the tile wall: 2×2 → 2+2, 2×3 → 4+2, 2×4 → 4+4. */
export function centerSplit(n: number): [number, number] {
  if (n <= 0) return [0, 0];
  if (n === 6) return [4, 2];
  if (n === 8 || n === 4) return [n / 2, n / 2];
  const left = Math.ceil(n / 2);
  return [left, n - left];
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

/**
 * Simultaneous view wall. Equal tiles (2×2 / 2×3 / 2×4), or those tiles plus a full-height
 * hero for the current view on the left, center, or right.
 */
export class Mosaic {
  private size: MosaicSize = "off";
  private hero: HeroPos = "off";
  private heroId = "";
  private extras: { id: string; scene: NetScene }[] = [];
  private panes = new Map<string, HTMLElement>();
  private liveArcade = new Set<string>();
  private focused = "";

  constructor(private cfg: {
    wall: HTMLElement;
    sceneEl: HTMLElement;
    main: NetScene;
    arcade: Record<string, ArcadeSlot>;
    optsFor: (m: ViewMode) => Record<string, string>;
    onFocus: (id: string) => void;
    sync: () => MosaicSync;
  }) {}

  get on(): boolean { return this.size !== "off"; }
  get current(): MosaicSize { return this.size; }
  get heroPos(): HeroPos { return this.hero; }
  get heroMode(): string { return this.heroId; }
  get layoutKey(): string { return `${this.size}:${this.hero}:${this.hero !== "off" ? this.heroId : ""}`; }
  get graphs(): NetScene[] { return [this.cfg.main, ...this.extras.map((e) => e.scene)]; }

  graphScene(id: string): NetScene | null {
    if (this.cfg.main.currentMode.id === id) return this.cfg.main;
    return this.extras.find((e) => e.id === id)?.scene ?? null;
  }

  setSize(size: MosaicSize, prefer?: string, hero: HeroPos = "off"): void {
    this.teardown();
    this.size = size;
    this.hero = size === "off" ? "off" : hero;
    this.heroId = "";
    document.body.classList.toggle("mosaic", size !== "off");
    document.body.dataset.mosaic = size;
    document.body.dataset.hero = this.hero;
    if (size === "off") {
      this.cfg.main.setCompactLabels(false);
      this.cfg.wall.append(this.cfg.sceneEl, ...Object.values(this.cfg.arcade).map((a) => a.el));
      return;
    }
    const ids = mosaicIds(size, prefer, this.hero);
    if (this.hero !== "off") this.heroId = ids[0] ?? "";
    const panes = new Map<string, HTMLElement>();
    const pending: { id: string; host: HTMLElement }[] = [];
    let usedMain = false;
    for (const id of ids) {
      const pane = this.makePane(id, id === this.heroId);
      panes.set(id, pane);
      if (isGraph(id)) {
        if (!usedMain) {
          pane.appendChild(this.cfg.sceneEl);
          this.cfg.main.setMode(modeById(id), this.cfg.optsFor(modeById(id)));
          usedMain = true;
        } else {
          const host = document.createElement("div");
          host.className = "mosaic-scene";
          pane.appendChild(host);
          pending.push({ id, host });
        }
      } else {
        const slot = this.cfg.arcade[arcadeKey(id)];
        if (!slot) continue;
        pane.appendChild(slot.el);
        slot.el.hidden = false;
        slot.el.classList.add("mosaic-live");
        slot.view.start();
        this.liveArcade.add(id);
      }
    }
    this.panes = panes;
    this.placePanes(ids);
    void this.cfg.wall.offsetHeight;
    const st = this.cfg.sync();
    for (const p of pending) {
      const s = new NetScene(p.host, { satellite: true });
      this.applySync(s, p.id, st);
      s.setMode(modeById(p.id), this.cfg.optsFor(modeById(p.id)));
      this.extras.push({ id: p.id, scene: s });
    }
    this.applyLooks(st.anim);
    this.paintPanes(st.theme);
    this.syncCompactLabels();
    this.relayoutAll();
    requestAnimationFrame(() => this.relayoutAll());
    this.focus(prefer && this.panes.has(prefer) ? prefer : ids[0] ?? "");
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

  /** Per-pane look from that view's plugin YAML, on top of the shared animation settings.
   *  `pin` false keeps the shared look (header AI cycling) on every tile. */
  applyLooks(a: DreamAnim, pin = true): void {
    if (!pin) {
      this.cfg.main.setAnim(a);
      for (const e of this.extras) e.scene.setAnim(a);
      return;
    }
    this.cfg.main.setAnim(mergeLook(a, lookForMode(this.cfg.main.currentMode.id)));
    for (const e of this.extras) e.scene.setAnim(mergeLook(a, lookForMode(e.id)));
  }

  /**
   * Hero / main scene keeps `t` (the selected chrome theme). Every other pane gets a different
   * shipped palette so the wall is not one colour repeated.
   */
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

  private syncCompactLabels(): void {
    const tile = this.hero === "off" || this.heroId !== this.cfg.main.currentMode.id;
    this.cfg.main.setCompactLabels(tile);
  }

  private relayoutAll(): void {
    this.cfg.main.relayout();
    for (const e of this.extras) e.scene.relayout();
  }

  private placePanes(ids: string[]): void {
    const wall = this.cfg.wall;
    if (this.hero === "off" || ids.length < 2) {
      for (const id of ids) {
        const pane = this.panes.get(id);
        if (pane) wall.appendChild(pane);
      }
      return;
    }
    const heroPane = this.panes.get(ids[0]!);
    const rest = ids.slice(1).map((id) => this.panes.get(id)).filter((p): p is HTMLElement => !!p);
    if (this.hero === "center") {
      const [leftN] = centerSplit(rest.length);
      wall.append(this.col(rest.slice(0, leftN)), heroPane!, this.col(rest.slice(leftN)));
      return;
    }
    const side = this.col(rest, rest.length > 3 ? 2 : 1);
    if (this.hero === "left") wall.append(heroPane!, side);
    else wall.append(side, heroPane!);
  }

  private col(panes: HTMLElement[], cols = 1): HTMLElement {
    const el = document.createElement("div");
    el.className = "mosaic-col";
    el.dataset.cols = String(cols);
    for (const p of panes) el.appendChild(p);
    return el;
  }

  private makePane(id: string, hero: boolean): HTMLElement {
    const pane = document.createElement("div");
    pane.className = hero ? "mosaic-pane hero" : "mosaic-pane";
    pane.dataset.mode = id;
    const cap = document.createElement("button");
    cap.type = "button";
    cap.className = "mosaic-cap";
    const label = viewCaption(modeById(id));
    cap.textContent = hero ? `${label} · hero` : label;
    cap.title = hero ? `${label} (hero)` : `make ${label} the hero`;
    cap.addEventListener("click", (e) => { e.stopPropagation(); this.cfg.onFocus(id); });
    pane.addEventListener("pointerdown", () => {
      if (this.focused !== id) this.cfg.onFocus(id);
    });
    pane.appendChild(cap);
    return pane;
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
    const used = new Set<string>([hero.id]);
    const mainId = this.cfg.main.currentMode.id;
    this.tintPane(mainId, hero);
    for (const e of this.extras) {
      const t = takeTheme(used, lookForMode(e.id)?.theme);
      e.scene.setTheme(t, fade);
      this.tintPane(e.id, t);
    }
    for (const id of this.liveArcade) {
      const t = takeTheme(used, lookForMode(id)?.theme);
      this.cfg.arcade[arcadeKey(id)]?.view.setTheme(t);
      this.tintPane(id, t);
    }
  }

  private tintPane(id: string, t: Theme): void {
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
    this.cfg.wall.replaceChildren();
  }
}
