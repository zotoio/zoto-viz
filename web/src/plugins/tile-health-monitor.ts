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
  type TilePatchBytes,
  freshTileHealthState,
  healthPatchOrigins,
  patchesAreNearUniform,
  resetTileHealthProgress,
  skyReadIsFlat,
  stepTileHealth,
  type HealStep,
  type PerTileHealthState,
  type TileHealLogEntry,
} from "./tile-health";
import { applyTileExemptReset, graceUntilFrom } from "./tile-health-exempt";

/** Live-blank notice: uniform on this many reads… */
export const LIVE_BLANK_READS = 3;
/** …each at least this far apart. */
export const LIVE_BLANK_SPACING_MS = 10_000;

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
  /**
   * Optional: the tile's sandbox frame for `packId` has reached `ready`. With sandbox draws
   * rising since the last check, the tile is healthy whatever the sampled patch says.
   */
  packLive?: (tileId: string, packId: string) => boolean;
  /**
   * Optional: tile shows a sandboxed pack with no sandbox frame (mosaic preview pane). The
   * pack cannot draw there, so the heal ladder must not judge it.
   */
  previewOnly?: (tileId: string) => boolean;
  /**
   * Optional: the tile's own sky is still starting ("<View> · Starting…" card up). It is not
   * blank, so it is neither healed nor given the live-blank notice.
   */
  skyStarting?: (tileId: string) => boolean;
  /**
   * Optional: a ready frame with draws rising is sampling uniform. The ladder does not escalate
   * (the pack is running), but the wall must say so — `blank` false clears the notice.
   */
  onLiveBlank?: (tileId: string, packId: string, blank: boolean) => void;
  /**
   * Optional (#216): a tile still empty after its one resend-frame. `true`: it is a pack tile and
   * now shows the pack's couldn't-start (Retry), staying on the pack: no restart, recreate, demo
   * or fallback. `false` (a built-in view): the ladder goes on.
   */
  onCantStart?: (tileId: string, packId: string) => boolean;
  /** Optional (#216): the tile shows couldn't-start. Not judged until Retry starts it again. */
  couldntStart?: (tileId: string) => boolean;
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
  private sandboxWriteGen = 0;
  private readonly lastPackByTile = new Map<string, string>();
  private readonly lastSandboxGenByTile = new Map<string, number>();
  private readonly liveBlankShown = new Map<string, string>();
  /** Times of spaced uniform reads while live-drawing (notice needs LIVE_BLANK_READS of them). */
  private readonly liveBlankReads = new Map<string, number[]>();
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

  /** A write that came from the pack's sandbox frame (the pack itself is drawing). */
  noteSandboxWrite(): void {
    this.sandboxWriteGen++;
    this.noteVizWrite();
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
    const packId = this.deps.packFor(tileId)?.id ?? tileId;
    const lastPack = this.lastPackByTile.get(tileId);
    this.lastPackByTile.set(tileId, packId);
    if (lastPack !== undefined && lastPack !== packId) {
      // Heal progress belongs to the pack that earned it: Voxel's ladder step and heal history
      // must not make Koi's first step fallback-pack.
      this.states.set(tileId, freshTileHealthState());
      this.lastSandboxGenByTile.delete(tileId);
      this.liveBlankReads.delete(tileId);
      this.setLiveBlank(tileId, null);
    }
    if (this.deps.previewOnly?.(tileId) || this.deps.skyStarting?.(tileId) || this.deps.couldntStart?.(tileId)) {
      this.resetProgress(tileId);
      this.setLiveBlank(tileId, null);
      return;
    }
    let liveDrawing = false;
    if (this.deps.packLive?.(tileId, packId)) {
      const lastGen = this.lastSandboxGenByTile.get(tileId);
      this.lastSandboxGenByTile.set(tileId, this.sandboxWriteGen);
      liveDrawing = lastGen !== undefined && this.sandboxWriteGen > lastGen;
    } else {
      this.lastSandboxGenByTile.delete(tileId);
    }
    if (!liveDrawing) {
      this.liveBlankReads.delete(tileId);
      this.setLiveBlank(tileId, null);
    }
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
    if (sc.gpuContextLost) return;
    const patch = this.sampleScene(sc, now);
    if (!patch) return; // async GL read pending — not empty
    let skyFlat: boolean | undefined;
    if (patchesAreNearUniform(patch)) {
      // #180: five patches can all land on one dark area of a working sky; confirm on the whole tile.
      const confirm = this.confirmSky(sc);
      if (confirm === "pending") return; // not empty this cycle
      skyFlat = confirm ?? undefined;
    }
    if (liveDrawing) {
      this.runLiveFloor(tileId, packId, patch, now, skyFlat);
      return;
    }
    this.runTileCheck(tileId, now, sc, patch, skyFlat);
  }

  /**
   * #180 confirm: the tile's sky alone, read coarsely over the whole tile. True / false: flat or
   * not; "pending": the async read is in flight; null: no confirm on this path (software, no pack
   * sky bound), so the five-patch verdict stands.
   */
  private confirmSky(sc: NetScene): boolean | "pending" | null {
    const host = this.deps.host;
    if (host.software) return null;
    const gl = host.gl;
    if (!gl || gl.isContextLost?.()) return null;
    const read = sc.tileHealthSkyRgba?.(gl);
    if (read === "pending") return "pending";
    if (!read) return null;
    return skyReadIsFlat(read);
  }

  /**
   * Floor: a ready frame whose draws keep rising never climbs the ladder. Non-uniform output is
   * healthy; uniform output is a pack running but showing nothing, which gets an on-screen notice.
   */
  private runLiveFloor(tileId: string, packId: string, patch: TilePatchBytes, now: number, skyFlat?: boolean): void {
    this.states.set(tileId, {
      ...resetTileHealthProgress(this.stateFor(tileId)),
      ladderIndex: 0,
      healAttempts: 0,
      forceDemo: false,
    });
    this.paintLabel(tileId, this.stateFor(tileId));
    if (!patchesAreNearUniform(patch) || skyFlat === false) {
      this.liveBlankReads.delete(tileId);
      this.setLiveBlank(tileId, null);
      return;
    }
    // Second guard: only a tile that reads uniform on LIVE_BLANK_READS samples at least
    // LIVE_BLANK_SPACING_MS apart (no non-uniform read between) gets the notice.
    const reads = this.liveBlankReads.get(tileId) ?? [];
    const last = reads[reads.length - 1];
    if (last === undefined || now - last >= LIVE_BLANK_SPACING_MS) reads.push(now);
    this.liveBlankReads.set(tileId, reads);
    if (reads.length >= LIVE_BLANK_READS) this.setLiveBlank(tileId, packId);
  }

  private setLiveBlank(tileId: string, packId: string | null): void {
    const shown = this.liveBlankShown.get(tileId);
    if (packId) {
      if (shown === packId) return;
      this.liveBlankShown.set(tileId, packId);
      console.info(`[zoto-viz tile-heal] tile=${tileId} pack=${packId} step=notice reason=live-blank`);
      this.deps.onLiveBlank?.(tileId, packId, true);
      return;
    }
    if (shown === undefined) return;
    this.liveBlankShown.delete(tileId);
    this.deps.onLiveBlank?.(tileId, shown, false);
  }

  private runTileCheck(
    tileId: string,
    now: number,
    sc: NetScene,
    patch: TilePatchBytes,
    skyFlat?: boolean,
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
        skyFlat,
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
    if (outcome.heal && outcome.heal !== "resend-frame" && this.deps.onCantStart?.(tileId, packId)) {
      // #216: past the one resend-frame a pack tile hands off to couldn't-start (Retry starts it
      // afresh) and never leaves the pick for another view (apply-mode's couldn't-start contract).
      this.states.set(tileId, freshTileHealthState());
      this.paintLabel(tileId, this.stateFor(tileId));
      console.info(`[zoto-viz tile-heal] tile=${tileId} pack=${packId} step=cant-start reason=${outcome.empty}`);
      return;
    }
    this.states.set(tileId, outcome.state);
    this.paintLabel(tileId, outcome.state);
    if (outcome.log) this.logHeal(outcome.log);
    if (outcome.heal) void this.deps.onHeal(tileId, outcome.heal, outcome.state);
  }

  private sampleScene(sc: NetScene, now: number): TilePatchBytes | null {
    const vp = sc.lastViewport;
    if (!vp || vp.w < 4 || vp.h < 4) return null;
    const host = this.deps.host;
    if (host.software) {
      const box = host.canvas.getBoundingClientRect();
      const el = sc.viewEl.getBoundingClientRect();
      const pr = host.pixelRatio;
      const origins = healthPatchOrigins(
        { x: (el.left - box.left) * pr, y: (el.top - box.top) * pr, w: el.width * pr, h: el.height * pr },
        TILE_PATCH,
      );
      return this.sampler.sampleMulti2d(host.canvas, origins, TILE_PATCH);
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
    this.lastPackByTile.delete(tileId);
    this.liveBlankReads.delete(tileId);
    this.lastSandboxGenByTile.delete(tileId);
    this.setLiveBlank(tileId, null);
    this.observers.get(tileId)?.disconnect();
    this.observers.delete(tileId);
    this.observerRoots.delete(tileId);
    this.onScreen.delete(tileId);
    this.labels.get(tileId)?.remove();
    this.labels.delete(tileId);
  }
}

export { HEAL_LADDER, TILE_LOAD_GRACE_MS };
