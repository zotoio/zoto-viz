import type { NetScene } from "../graph/scene";
import type { RenderHost, Viewport } from "../graph/render-host";
import type { Mosaic } from "../graph/mosaic";
import type { PluginView } from "./plugin";
import {
  HEAL_LADDER,
  TILE_CHECK_MS,
  TILE_LOAD_GRACE_MS,
  TILE_PATCH,
  TilePatchSampler,
  freshTileHealthState,
  resetTileHealthProgress,
  stepTileHealth,
  type HealStep,
  type PerTileHealthState,
  type TileHealLogEntry,
} from "./tile-health";
import { applyTileExemptReset, graceUntilFrom } from "./tile-health-exempt";

export const TILE_HEAL_ERRORS_KEY = "zoto-viz.tileHealErrors";

export function readTileHealErrors(store: Pick<Storage, "getItem"> = localStorage): boolean {
  return store.getItem(TILE_HEAL_ERRORS_KEY) === "1";
}

export function writeTileHealErrors(on: boolean, store: Pick<Storage, "setItem"> = localStorage): void {
  store.setItem(TILE_HEAL_ERRORS_KEY, on ? "1" : "0");
}

export interface TileHealthDeps {
  host: RenderHost;
  mainScene: NetScene;
  mosaic: Mosaic | null;
  paneEl: (tileId: string) => HTMLElement | null;
  sceneFor: (tileId: string) => NetScene | null;
  packFor: (tileId: string) => PluginView | null;
  mayBeStatic: (spec: PluginView | null) => boolean;
  /** Layout-visible (not zero-size / hidden chrome). */
  isVisible: (tileId: string) => boolean;
  /** Consent / auth reason card — tile must not count as empty. */
  awaitingApproval: (tileId: string) => boolean;
  showErrors: () => boolean;
  onHeal: (tileId: string, step: HealStep, state: PerTileHealthState) => void | Promise<void>;
  /** Optional: override tab visibility (tests). */
  tabVisible?: () => boolean;
  /** Optional: override on-screen (tests). */
  onScreen?: (tileId: string) => boolean;
}

export class TileHealthMonitor {
  private readonly sampler = new TilePatchSampler();
  private readonly states = new Map<string, PerTileHealthState>();
  private readonly labels = new Map<string, HTMLSpanElement>();
  private readonly graceUntil = new Map<string, number>();
  private readonly onScreen = new Map<string, boolean>();
  private readonly observers = new Map<string, IntersectionObserver>();
  private readonly observerRoots = new Map<string, Element>();
  private stagger = 0;
  private lastTick = 0;
  private vizDeliverGen = 0;
  private vizWriteGen = 0;
  private lastVizWriteGen = 0;
  private packDrawingNothing = false;
  private tabVisible = typeof document !== "undefined" ? document.visibilityState !== "hidden" : true;

  constructor(private readonly deps: TileHealthDeps) {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onTabVisibility);
    }
  }

  dispose(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onTabVisibility);
    }
    for (const o of this.observers.values()) o.disconnect();
    this.observers.clear();
  }

  private readonly onTabVisibility = (): void => {
    const visible = this.deps.tabVisible?.() ?? document.visibilityState !== "hidden";
    if (visible !== this.tabVisible) {
      this.tabVisible = visible;
      this.resetAllProgress();
    }
  };

  /** Start / extend load grace after view bind, dropdown change, or source change. */
  noteGrace(tileId: string, now = performance.now()): void {
    this.graceUntil.set(tileId, graceUntilFrom(now));
    this.resetProgress(tileId);
    this.ensureObserver(tileId);
  }

  noteVizFrameDelivered(): void {
    this.vizDeliverGen++;
    this.lastVizWriteGen = this.vizWriteGen;
  }

  noteVizWrite(): void {
    this.vizWriteGen++;
    this.packDrawingNothing = false;
  }

  setPackDrawingNothing(on: boolean): void {
    this.packDrawingNothing = on;
  }

  forceDemo(tileId: string): boolean {
    return this.states.get(tileId)?.forceDemo ?? false;
  }

  pinnedFallback(tileId: string): boolean {
    return this.states.get(tileId)?.pinnedFallback ?? false;
  }

  state(tileId: string): PerTileHealthState {
    return this.stateFor(tileId);
  }

  /** Call from rAF or present listener (~every frame); runs at most one tile check per interval. */
  tick(now = performance.now()): void {
    if (!(this.deps.tabVisible?.() ?? this.tabVisible)) return;
    const tiles = this.eligibleTiles();
    if (!tiles.length) return;
    const interval = TILE_CHECK_MS / tiles.length;
    if (now - this.lastTick < interval) return;
    this.lastTick = now;
    const tileId = tiles[this.stagger % tiles.length]!;
    this.stagger++;
    this.checkTile(tileId, now);
  }

  private eligibleTiles(): string[] {
    const all = this.visibleTiles();
    for (const id of all) {
      if (!this.isOnScreen(id)) this.resetProgress(id);
    }
    return all.filter((id) => this.isOnScreen(id));
  }

  private visibleTiles(): string[] {
    const m = this.deps.mosaic;
    if (m?.on) return m.tileIds.filter((id) => this.deps.isVisible(id));
    return ["main"];
  }

  private isOnScreen(tileId: string): boolean {
    if (this.deps.onScreen) return this.deps.onScreen(tileId);
    return this.onScreen.get(tileId) ?? true;
  }

  private ensureObserver(tileId: string): void {
    if (this.deps.onScreen || typeof IntersectionObserver === "undefined") return;
    const root = this.deps.paneEl(tileId) ?? this.deps.sceneFor(tileId)?.viewEl;
    if (!root) return;
    if (this.observerRoots.get(tileId) === root && this.observers.has(tileId)) return;
    this.observers.get(tileId)?.disconnect();
    this.observers.delete(tileId);
    this.observerRoots.delete(tileId);
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const on = e.isIntersecting && e.intersectionRatio > 0;
        this.onScreen.set(tileId, on);
        if (!on) this.resetProgress(tileId);
      }
    }, { threshold: [0, 0.01] });
    obs.observe(root);
    this.observers.set(tileId, obs);
    this.observerRoots.set(tileId, root);
  }

  private stateFor(tileId: string): PerTileHealthState {
    let s = this.states.get(tileId);
    if (!s) {
      s = freshTileHealthState();
      this.states.set(tileId, s);
    }
    return s;
  }

  private resetProgress(tileId: string): void {
    const s = this.stateFor(tileId);
    this.states.set(tileId, resetTileHealthProgress(s));
  }

  private resetAllProgress(): void {
    for (const id of new Set([...this.states.keys(), ...this.visibleTiles()])) {
      this.resetProgress(id);
    }
  }

  private exemptInput(tileId: string, now: number) {
    return {
      tabVisible: this.deps.tabVisible?.() ?? this.tabVisible,
      onScreen: this.isOnScreen(tileId),
      awaitingApproval: this.deps.awaitingApproval(tileId),
      graceUntil: this.graceUntil.get(tileId) ?? 0,
      now,
    };
  }

  private checkTile(tileId: string, now: number): void {
    this.ensureObserver(tileId);
    const exemptIn = this.exemptInput(tileId, now);
    let prev = this.stateFor(tileId);
    prev = applyTileExemptReset(prev, exemptIn);
    this.states.set(tileId, prev);
    if (exemptIn.tabVisible === false
      || !exemptIn.onScreen
      || exemptIn.awaitingApproval
      || now < exemptIn.graceUntil) {
      return;
    }

    const sc = this.deps.sceneFor(tileId);
    if (!sc) return;
    if (sc.gpuContextLost) {
      this.runTileCheck(tileId, now, sc, this.sampler.scratchBuffer);
      return;
    }
    const patch = this.sampleScene(sc, now);
    if (!patch) return; // async GL read pending — not empty
    this.runTileCheck(tileId, now, sc, patch);
  }

  private runTileCheck(
    tileId: string,
    now: number,
    sc: NetScene,
    patch: Uint8Array | Uint8ClampedArray,
  ): void {
    const prev = this.stateFor(tileId);
    const spec = this.deps.packFor(tileId);
    const packId = spec?.id ?? tileId;
    const dataArriving = this.vizDeliverGen > 0;
    const drawingNothing = this.packDrawingNothing
      || (dataArriving && this.vizWriteGen === this.lastVizWriteGen && !!spec?.capabilities?.includes("viz.read"));
    const outcome = stepTileHealth(
      prev,
      now,
      {
        patch,
        lastCheckPictureSerial: prev.lastCheckPictureSerial,
        signals: {
          mayBeStatic: this.deps.mayBeStatic(spec),
          contextLost: sc.gpuContextLost,
          pictureSerial: sc.pictureSerial,
          dataFramesArriving: dataArriving,
          drawingNothing,
        },
      },
      tileId,
      packId,
    );
    this.states.set(tileId, outcome.state);
    this.paintLabel(tileId, outcome.state);
    if (outcome.log) this.logHeal(outcome.log);
    if (outcome.heal) void this.deps.onHeal(tileId, outcome.heal, outcome.state);
  }

  private sampleScene(sc: NetScene, now: number): Uint8Array | Uint8ClampedArray | null {
    const vp = sc.lastViewport;
    if (!vp || vp.w < 4 || vp.h < 4) return null;
    const host = this.deps.host;
    if (host.software) {
      const box = host.canvas.getBoundingClientRect();
      const el = sc.viewEl.getBoundingClientRect();
      const pr = host.pixelRatio;
      const sx = (el.left - box.left) * pr + (el.width * pr) / 2 - TILE_PATCH / 2;
      const sy = (el.top - box.top) * pr + (el.height * pr) / 2 - TILE_PATCH / 2;
      return this.sampler.sample2d(host.canvas, sx, sy, TILE_PATCH, TILE_PATCH);
    }
    const gl = host.gl;
    if (!gl || gl.isContextLost?.()) return null;
    return sc.tileHealthRgba(gl, now);
  }

  private labelFor(tileId: string): HTMLSpanElement {
    let el = this.labels.get(tileId);
    if (el) return el;
    const pane = this.deps.paneEl(tileId) ?? this.deps.mainScene.viewEl;
    el = document.createElement("span");
    el.className = "tile-heal-msg";
    el.setAttribute("aria-live", "polite");
    pane.appendChild(el);
    this.labels.set(tileId, el);
    return el;
  }

  private paintLabel(tileId: string, state: PerTileHealthState): void {
    const el = this.labelFor(tileId);
    const show = this.deps.showErrors() && state.lastMessage;
    el.textContent = show ? state.lastMessage : "";
    el.hidden = !show;
  }

  private logHeal(entry: TileHealLogEntry): void {
    const line = `[zoto-viz tile-heal] tile=${entry.tileId} pack=${entry.packId} step=${entry.step} reason=${entry.reason}`;
    console.info(line);
  }

  /** Test hook: run checks with explicit time steps. */
  runChecks(count: number, now = performance.now()): void {
    for (let i = 0; i < count; i++) {
      this.tick(now + i * (TILE_CHECK_MS / Math.max(1, this.eligibleTiles().length)));
    }
  }

  resetTile(tileId: string): void {
    this.states.delete(tileId);
    this.graceUntil.delete(tileId);
    this.observers.get(tileId)?.disconnect();
    this.observers.delete(tileId);
    this.observerRoots.delete(tileId);
    this.onScreen.delete(tileId);
    this.labels.get(tileId)?.remove();
    this.labels.delete(tileId);
  }
}

export { HEAL_LADDER, TILE_LOAD_GRACE_MS };
