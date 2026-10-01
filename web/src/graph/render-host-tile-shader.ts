import * as THREE from "three";
import { GfxWallNotice } from "./gfx-wall-notice";
import { TileShaderLatch } from "./tile-shader-latch";
import { TileShaderFallback } from "./tile-shader-fallback";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";
import {
  SHADER_FALLBACK_TICK_MS,
  type ShaderPack,
  resolveShaderFallbackLine,
  shaderPackForId,
} from "./shader-pack-fallback";

class TileShaderSlot {
  readonly latch = new TileShaderLatch();
  fallback: TileShaderFallback | null = null;
  packKey = "";
  packId = "";
  packName = "";
  mount: HTMLElement | null = null;
  isShaderPack = false;
  shaderPack: ShaderPack = {};
  compileFailed = false;
  mountedFallbackPackKey = "";
  /** Info log of the last failed compile (for the tile's cant-draw state; console only). */
  failLog = "";

  swapPack(
    packKey: string,
    packId: string,
    packName: string,
    mount: HTMLElement,
    isShaderPack = false,
  ): void {
    if (this.packKey !== packKey) {
      this.packKey = packKey;
      this.packId = packId;
      this.latch.reset();
      this.compileFailed = false;
      this.failLog = "";
      this.fallback?.dispose();
      this.fallback = null;
      this.mountedFallbackPackKey = "";
    }
    this.packName = packName;
    this.mount = mount;
    this.isShaderPack = isShaderPack;
    this.shaderPack = isShaderPack ? shaderPackForId(packId) : {};
  }
}

export interface RenderHostShaderGpu {
  readonly software: boolean;
  readonly renderer: THREE.WebGLRenderer | { getContext(): WebGL2RenderingContext | null };
  glContextLost: boolean;
  invalidate(): void;
  /** Tile ids of the views drawn on this host (every tile a lost context stops). */
  drawTileIds?(): readonly string[];
}

/**
 * What the host knows about a tile's ability to draw (#171 c / #179). The app turns these into
 * each tile's `cant-draw` view state; the graph layer never writes view state itself.
 * - `context-lost`: the shared context is lost, every tile on the host stops drawing.
 * - `reload-offered`: the wall notice now shows Reload (no longer "restoring").
 * - `context-drawn`: the context is back and a real frame has drawn (the wall notice clears now).
 * - `shader-failed`: one tile's shader failed to compile or link.
 * - `shader-cleared`: that tile's shader compiled, or its pack was swapped or cleared.
 */
export type TileDrawEvent =
  | { type: "context-lost"; tileIds: readonly string[] }
  | { type: "reload-offered"; tileIds: readonly string[] }
  | { type: "context-drawn"; tileIds: readonly string[] }
  | { type: "shader-failed"; tileId: string; packId: string; log: string }
  | { type: "shader-cleared"; tileId: string };

/** Per-tile shader compile latch, simple-view fallback, and wall context-loss notice. */
export class RenderHostTileShader {
  private readonly tileShaders = new Map<string, TileShaderSlot>();
  readonly gfxNotice: GfxWallNotice;
  private readonly fallbackTileIds = new Set<string>();
  private fallbackTick: ReturnType<typeof setInterval> | null = null;
  private readonly drawListeners = new Set<(e: TileDrawEvent) => void>();

  constructor(
    private readonly wall: HTMLElement,
    private readonly host: RenderHostShaderGpu,
  ) {
    this.gfxNotice = new GfxWallNotice(wall, {
      onDismissLateReload: () => host.invalidate(),
      onReloadOffered: () => this.emit({ type: "reload-offered", tileIds: this.drawTileIds() }),
    });
  }

  /** Subscribe to tile draw events (see `TileDrawEvent`); returns the unsubscribe. */
  onDrawEvent(fn: (e: TileDrawEvent) => void): () => void {
    this.drawListeners.add(fn);
    return () => { this.drawListeners.delete(fn); };
  }

  private drawTileIds(): readonly string[] {
    return this.host.drawTileIds?.() ?? [];
  }

  private emit(e: TileDrawEvent): void {
    for (const fn of [...this.drawListeners]) {
      try {
        fn(e);
      } catch (err) {
        console.warn("zoto-viz tile draw listener:", err);
      }
    }
  }

  get contextLost(): boolean {
    return this.host.glContextLost;
  }

  /** Lost now, even if the `webglcontextlost` event is still queued (a loss during a compile). */
  private contextLostNow(): boolean {
    if (this.host.glContextLost) return true;
    try {
      return this.host.renderer.getContext()?.isContextLost?.() === true;
    } catch {
      return false;
    }
  }

  tileSlot(tileId: string): TileShaderSlot {
    let slot = this.tileShaders.get(tileId);
    if (!slot) {
      slot = new TileShaderSlot();
      this.tileShaders.set(tileId, slot);
    }
    return slot;
  }

  beginTilePack(
    tileId: string,
    packKey: string,
    packId: string,
    mount: HTMLElement,
    packName: string,
    isShaderPack = false,
  ): void {
    const slot = this.tileSlot(tileId);
    const swapped = slot.packKey !== packKey;
    if (swapped) this.stopFallbackTile(tileId, slot);
    slot.swapPack(packKey, packId, packName, mount, isShaderPack);
    if (swapped) this.emit({ type: "shader-cleared", tileId });
  }

  probeTileSky(
    tileId: string,
    scene: THREE.Scene,
    camera: THREE.Camera,
    log: (msg: string) => void = () => {},
  ): string | null {
    if (this.host.glContextLost) return null;
    const ok = this.compilePluginSky(tileId, scene, camera, log);
    if (!ok) {
      // A context lost mid-compile is not a shader failure: the tile is re-probed after the
      // restore instead of being marked dead behind the simple-view fallback (#179).
      if (this.contextLostNow() && !this.tileSlot(tileId).latch.dead) return null;
      this.onTileShaderCompileFailed(tileId);
      return "shader failed";
    }
    this.onTileShaderCompileOk(tileId);
    return null;
  }

  compilePluginSky(
    tileId: string,
    scene: THREE.Scene,
    camera: THREE.Camera,
    log: (msg: string) => void = () => {},
  ): boolean {
    if (this.host.software) return true;
    if (this.host.glContextLost) return false;
    const rd = this.host.renderer as THREE.WebGLRenderer;
    if (typeof rd.compile !== "function") return true;
    const slot = this.tileSlot(tileId);
    const latch = slot.latch;
    if (latch.dead) return false;
    if (latch.isFresh()) return true;

    if (!rd.debug) {
      rd.debug = { checkShaderErrors: true, onShaderError: null };
    }
    const prevCheck = rd.debug.checkShaderErrors;
    const prevOn = rd.debug.onShaderError;
    rd.debug.checkShaderErrors = true;
    let lostDuringCompile = false;
    rd.debug.onShaderError = (gl, program, _vs, fs) => {
      // Empty logs from a context that just died say nothing about the shader.
      if (typeof gl.isContextLost === "function" && gl.isContextLost()) {
        lostDuringCompile = true;
        return;
      }
      const msg = (
        gl.getShaderInfoLog(fs)
        || gl.getProgramInfoLog(program)
        || "shader failed"
      ).trim();
      slot.failLog = msg || "shader failed";
      latch.fail(slot.failLog, log);
    };
    try {
      rd.compile(scene, camera);
    } finally {
      rd.debug.checkShaderErrors = prevCheck;
      rd.debug.onShaderError = prevOn;
    }
    if (latch.dead) return false;
    if (lostDuringCompile || this.contextLostNow()) return false;
    latch.markCompiled();
    return true;
  }

  onTileShaderCompileFailed(tileId: string): void {
    this.mountShaderFallback(tileId);
    const slot = this.tileSlot(tileId);
    this.emit({ type: "shader-failed", tileId, packId: slot.packId, log: slot.failLog || "shader failed" });
  }

  onTileShaderCompileOk(tileId: string): void {
    this.clearShaderFallback(tileId);
  }

  tileShaderDead(tileId: string): boolean {
    return this.tileSlot(tileId).latch.dead;
  }

  clearShaderFallback(tileId: string): void {
    const slot = this.tileShaders.get(tileId);
    if (!slot) return;
    this.stopFallbackTile(tileId, slot);
    slot.fallback?.dispose();
    slot.fallback = null;
    slot.mountedFallbackPackKey = "";
    slot.compileFailed = false;
    this.emit({ type: "shader-cleared", tileId });
  }

  onSharedContextLost(): void {
    if (this.host.glContextLost) return;
    this.host.glContextLost = true;
    if (this.fallbackTick !== null) {
      clearInterval(this.fallbackTick);
      this.fallbackTick = null;
    }
    this.fallbackTileIds.clear();
    // #245: the emit sets the tiles' couldn't-draw marker; it goes first so the wall notice (#236) sees
    // a solo tile that already says the loss and is hidden in the same call that inserts it.
    this.emit({ type: "context-lost", tileIds: this.drawTileIds() });
    this.gfxNotice.onContextLost();
  }

  onSharedContextRestored(): void {
    this.host.glContextLost = false;
    for (const slot of this.tileShaders.values()) {
      slot.latch.reset();
    }
  }

  /** The first real frame has drawn since the restore: now the wall notice may clear (#179 row 4). */
  onFirstFrameAfterRestore(): void {
    this.gfxNotice.onContextRestored();
    this.emit({ type: "context-drawn", tileIds: this.drawTileIds() });
  }

  dispose(): void {
    this.clearAllShaderFallbacks();
    // A host torn down while lost must not leave its wall notice (or its timer) behind.
    this.gfxNotice.dispose();
  }

  private mountShaderFallback(tileId: string): void {
    const slot = this.tileSlot(tileId);
    if (!slot.isShaderPack) return;
    slot.compileFailed = true;
    if (slot.fallback && slot.mountedFallbackPackKey === slot.packKey) {
      this.refreshShaderFallbackText(tileId);
      return;
    }
    this.stopFallbackTile(tileId, slot);
    slot.fallback?.dispose();
    let initialText: string;
    try {
      initialText = resolveShaderFallbackLine(slot.shaderPack, slot.packName);
    } catch {
      initialText = genericShaderFallbackMessage(slot.packName);
    }
    const showChip = typeof slot.shaderPack.fallbackText === "function"
      && initialText !== genericShaderFallbackMessage(slot.packName);
    slot.fallback = new TileShaderFallback(slot.mount!, {
      packName: slot.packName,
      showChip,
      initialText,
    });
    slot.mountedFallbackPackKey = slot.packKey;
    if (!slot.latch.dead) this.startFallbackTile(tileId);
  }

  private refreshShaderFallbackText(tileId: string): void {
    const slot = this.tileShaders.get(tileId);
    if (!slot?.fallback) return;
    let line: string;
    try {
      line = resolveShaderFallbackLine(slot.shaderPack, slot.packName);
    } catch {
      line = genericShaderFallbackMessage(slot.packName);
    }
    slot.fallback.applyText(line);
  }

  private startFallbackTile(tileId: string): void {
    this.fallbackTileIds.add(tileId);
    if (this.fallbackTick !== null) return;
    this.fallbackTick = setInterval(() => {
      for (const id of this.fallbackTileIds) this.refreshShaderFallbackText(id);
    }, SHADER_FALLBACK_TICK_MS);
  }

  private stopFallbackTile(tileId: string, _slot: TileShaderSlot): void {
    this.fallbackTileIds.delete(tileId);
    if (this.fallbackTileIds.size === 0 && this.fallbackTick !== null) {
      clearInterval(this.fallbackTick);
      this.fallbackTick = null;
    }
  }

  private clearAllShaderFallbacks(): void {
    if (this.fallbackTick !== null) {
      clearInterval(this.fallbackTick);
      this.fallbackTick = null;
    }
    this.fallbackTileIds.clear();
    for (const slot of this.tileShaders.values()) {
      slot.fallback?.dispose();
      slot.fallback = null;
      slot.mountedFallbackPackKey = "";
      slot.compileFailed = false;
    }
  }
}
