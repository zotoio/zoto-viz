import type { PluginHostHandlers } from "../plugins/host";
import { pluginHasFrontend, vizContractFor, type PluginView } from "../plugins/plugin";
import {
  applyPackFeedPaneNotice,
  markSandboxStartupFailed,
  markSandboxStartupOk,
  markSandboxUnloaded,
  type MosaicNoticeHost,
} from "../plugins/plugin-pack-feed";
import { registerPackAssetRetry } from "../plugins/pack-asset-frame";
import {
  bindVizWriterCore,
  defaultVizContract,
  type VizBufferWriter,
  type VizDataFrame,
  type VizUniformValue,
} from "../plugins/viz-host";
import { applyVizWriteBatch } from "../plugins/viz-write-batch";

/**
 * #233: one sandbox per mosaic tile. main.ts's shared `sandbox` keeps the solo view ("main") and
 * the mosaic tile it drives (sandboxVizTileId); every other pane that shows a sandboxed pack boots
 * it in a sandbox of its own, with its own iframe, module, writer, frames, notice and Retry.
 */
export function ownsSandboxTile(tileId: string, drivenTileId: string): boolean {
  return tileId !== "main" && tileId !== drivenTileId;
}

/** The PluginSandbox surface a tile's sandbox needs (tests pass a stand-in). */
export interface TileSandboxLike {
  handlers: PluginHostHandlers;
  readonly readyPack: string;
  setActiveTile(tileId: string): void;
  frame(frame: VizDataFrame): void;
  unload(): void;
}

/** The pane scene a tile's own writes land on. */
export type TileSandboxTarget = {
  setPluginUboBuffer(buf: Float32Array): void;
  setPluginUniform(name: string, value: VizUniformValue): unknown;
};

export interface TileSandboxDeps<S extends TileSandboxLike> {
  /** The shared sandbox (solo view and the driven mosaic tile). */
  main: S;
  create: () => S;
  /** Tile the shared sandbox drives (main.ts sandboxVizTileId). */
  drivenTile: () => string;
  target: (tileId: string) => TileSandboxTarget | null;
  /** Packs this host may boot at all (TS plugins on, consent given). */
  mayLoad: (spec: PluginView) => boolean;
  /** Boot `spec` in the tile's own sandbox (attachPluginFrontend in main.ts). */
  attach: (sandbox: S, spec: PluginView, tileId: string) => Promise<void>;
  /** After the tile's pack is ready: its sky installs now (#226 order, per tile). */
  afterReady?: (tileId: string) => void;
  noticeHost?: () => MosaicNoticeHost | null | undefined;
  /** A write from the tile's own sandbox (tile-health hook; per tile once #227 lands). */
  noteWrite?: (tileId: string) => void;
}

type TileEntry<S> = {
  sandbox: S;
  spec: PluginView;
  writer: VizBufferWriter | null;
  ready: boolean;
};

export class TileSandboxes<S extends TileSandboxLike> {
  private readonly byTile = new Map<string, TileEntry<S>>();

  constructor(private readonly deps: TileSandboxDeps<S>) {}

  get size(): number {
    return this.byTile.size;
  }

  has(tileId: string): boolean {
    return this.byTile.has(tileId);
  }

  tiles(): string[] {
    return [...this.byTile.keys()];
  }

  /** The sandbox driving `tileId`: the tile's own, else the shared one. */
  sandboxFor(tileId: string): S {
    return this.byTile.get(tileId)?.sandbox ?? this.deps.main;
  }

  /** Pack whose frame reached ready in the tile's own sandbox ("" when it has none). */
  readyPackFor(tileId: string): string {
    return this.byTile.get(tileId)?.sandbox.readyPack ?? "";
  }

  /** The tile's own sandbox is still booting: its sky waits for the ready (#226). */
  awaitingReady(tileId: string): boolean {
    const e = this.byTile.get(tileId);
    return !!e && !e.ready;
  }

  /** Tiles the shared sandbox's writes still reach (the rest draw their own). */
  sharedTiles(tileIds: readonly string[]): string[] {
    return tileIds.filter((id) => !this.byTile.has(id));
  }

  /** The pane wants a sandbox of its own for `spec`. */
  wants(tileId: string, spec: PluginView | null): spec is PluginView {
    return !!spec?.hash
      && pluginHasFrontend(spec)
      && ownsSandboxTile(tileId, this.deps.drivenTile())
      && this.deps.mayLoad(spec);
  }

  /** Match the tiles on screen: boot a sandbox for each pane that wants one, unload the rest. */
  sync(tiles: readonly { id: string; spec: PluginView | null }[]): void {
    const keep = new Set<string>();
    for (const { id, spec } of tiles) {
      if (!this.wants(id, spec)) continue;
      keep.add(id);
      const e = this.byTile.get(id);
      if (e && e.spec.id === spec.id && e.spec.hash === spec.hash) continue;
      void this.load(id, spec);
    }
    for (const id of this.tiles()) if (!keep.has(id)) this.drop(id);
  }

  /** One post per present to every tile's own sandbox. */
  frame(frame: VizDataFrame): void {
    for (const e of this.byTile.values()) e.sandbox.frame(frame);
  }

  /** Unload the tile's own sandbox; other tiles keep theirs. */
  drop(tileId: string): void {
    const e = this.byTile.get(tileId);
    if (!e) return;
    this.byTile.delete(tileId);
    e.sandbox.unload();
    markSandboxUnloaded(tileId);
  }

  /** Retry on this tile only. False when the tile has no sandbox of its own. */
  async restart(tileId: string): Promise<boolean> {
    const e = this.byTile.get(tileId);
    if (!e) return false;
    await this.load(tileId, e.spec);
    return true;
  }

  async load(tileId: string, spec: PluginView): Promise<void> {
    const prev = this.byTile.get(tileId);
    if (prev) prev.sandbox.unload();
    const sandbox = this.deps.create();
    sandbox.setActiveTile(tileId);
    const contract = vizContractFor(spec) ?? (spec.capabilities?.includes("viz.write") ? defaultVizContract() : undefined);
    const writer = bindVizWriterCore(null, contract).writer;
    const entry: TileEntry<S> = { sandbox, spec, writer, ready: false };
    sandbox.handlers = this.handlersFor(tileId, writer);
    this.byTile.set(tileId, entry);
    const label = spec.name ?? spec.id;
    registerPackAssetRetry(tileId, label, () => { void this.restart(tileId); });
    try {
      await this.deps.attach(sandbox, spec, tileId);
      if (this.byTile.get(tileId) !== entry) return;
      entry.ready = true;
      markSandboxStartupOk(tileId);
      applyPackFeedPaneNotice(this.deps.noticeHost?.(), tileId, label);
      this.deps.afterReady?.(tileId);
    } catch (e) {
      if (this.byTile.get(tileId) !== entry) return;
      console.warn("zoto-viz plugin runtime:", tileId, e);
      markSandboxStartupFailed(tileId);
      applyPackFeedPaneNotice(this.deps.noticeHost?.(), tileId, label);
      sandbox.unload();
    }
  }

  private handlersFor(tileId: string, writer: VizBufferWriter | null): PluginHostHandlers {
    const target = (): TileSandboxTarget | null => this.deps.target(tileId);
    const note = (): void => this.deps.noteWrite?.(tileId);
    return {
      writeBuffer: (slot, data) => {
        note();
        if (writer?.writeBuffer(slot, data).ok) target()?.setPluginUboBuffer(writer.ubo);
      },
      writeUniform: (name, value) => {
        note();
        if (writer?.writeUniform(name, value).ok) target()?.setPluginUniform(name, value);
      },
      writeParticles: (data, stride) => {
        note();
        writer?.writeParticles(data, stride);
      },
      writeBatch: (batch) => {
        if (!writer) return;
        applyVizWriteBatch(writer, batch, {
          onBuffer: () => {
            note();
            target()?.setPluginUboBuffer(writer.ubo);
          },
          onUniform: (name, value) => {
            note();
            target()?.setPluginUniform(name, value);
          },
        });
      },
    };
  }
}
