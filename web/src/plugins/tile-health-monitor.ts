import type { NetScene } from "../graph/scene";
import type { RenderHost, Viewport } from "../graph/render-host";
import type { Mosaic } from "../graph/mosaic";
import type { PluginView } from "./plugin";
import {
  HEAL_LADDER,
  TILE_CHECK_MS,
  TILE_HEAL_FALLBACK_MODE,
  TILE_PATCH,
  TilePatchSampler,
  freshTileHealthState,
  patchOrigin,
  stepTileHealth,
  type HealStep,
  type PerTileHealthState,
  type TileHealLogEntry,
} from "./tile-health";

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
  isVisible: (tileId: string) => boolean;
  showErrors: () => boolean;
  onHeal: (tileId: string, step: HealStep, state: PerTileHealthState) => void | Promise<void>;
}

export class TileHealthMonitor {
  private readonly sampler = new TilePatchSampler();
  private readonly states = new Map<string, PerTileHealthState>();
  private readonly labels = new Map<string, HTMLSpanElement>();
  private stagger = 0;
  private lastTick = 0;
  private vizDeliverGen = 0;
  private vizWriteGen = 0;
  private lastVizWriteGen = 0;
  private packDrawingNothing = false;

  constructor(private readonly deps: TileHealthDeps) {}

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

  /** Call from rAF or present listener (~every frame); runs at most one tile check per interval. */
  tick(now = performance.now()): void {
    const tiles = this.visibleTiles();
    if (!tiles.length) return;
    const interval = TILE_CHECK_MS / tiles.length;
    if (now - this.lastTick < interval) return;
    this.lastTick = now;
    const tileId = tiles[this.stagger % tiles.length]!;
    this.stagger++;
    this.checkTile(tileId, now);
  }

  private visibleTiles(): string[] {
    const m = this.deps.mosaic;
    if (m?.on) return m.tileIds.filter((id) => this.deps.isVisible(id));
    return ["main"];
  }

  private stateFor(tileId: string): PerTileHealthState {
    let s = this.states.get(tileId);
    if (!s) {
      s = freshTileHealthState();
      this.states.set(tileId, s);
    }
    return s;
  }

  private checkTile(tileId: string, now: number): void {
    const sc = this.deps.sceneFor(tileId);
    if (!sc) return;
    const patch = this.sampleScene(sc);
    if (!patch) return;
    const spec = this.deps.packFor(tileId);
    const packId = spec?.id ?? tileId;
    const dataArriving = this.vizDeliverGen > 0;
    const drawingNothing = this.packDrawingNothing
      || (dataArriving && this.vizWriteGen === this.lastVizWriteGen && !!spec?.capabilities?.includes("viz.read"));
    const prev = this.stateFor(tileId);
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

  private sampleScene(sc: NetScene): Uint8ClampedArray | null {
    const vp = sc.lastViewport;
    if (!vp || vp.w < 4 || vp.h < 4) return null;
    const host = this.deps.host;
    if (host.software) {
      const box = host.canvas.getBoundingClientRect();
      const el = sc.viewEl.getBoundingClientRect();
      const pr = host.pixelRatio;
      const sx = (el.left - box.left) * pr + (el.width * pr) / 2 - TILE_PATCH / 2;
      const sy = (el.top - box.top) * pr + (el.height * pr) / 2 - TILE_PATCH / 2;
      const sw = Math.max(1, el.width * pr);
      const sh = Math.max(1, el.height * pr);
      return this.sampler.sample2d(host.canvas, sx, sy, sw, sh);
    }
    const gl = host.gl;
    if (!gl || gl.isContextLost()) return this.sampler.scratchBuffer;
    const { x, y } = patchOrigin(vp);
    return this.sampler.sampleGl(gl, x, y);
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

  /** Test hook: run N checks without waiting for real time. */
  runChecks(count: number, now = performance.now()): void {
    for (let i = 0; i < count; i++) this.tick(now + i * (TILE_CHECK_MS / Math.max(1, this.visibleTiles().length)));
  }

  resetTile(tileId: string): void {
    this.states.delete(tileId);
    this.labels.get(tileId)?.remove();
    this.labels.delete(tileId);
  }
}

export { HEAL_LADDER };
