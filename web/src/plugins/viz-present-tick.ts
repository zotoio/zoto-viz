import type { PluginSandbox } from "./host";
import type { VizPluginContract, VizPresentTick } from "./viz-host";

export interface PresentTileMode {
  pluginId?: string;
}

export interface DeliverPresentTickInput {
  sandbox: PluginSandbox;
  contract: VizPluginContract | undefined;
  frameMs: number;
  pluginClock?: number;
  mosaicOn: boolean;
  /** Mosaic leaf view mode ids (pane keys). */
  tileIds: readonly string[];
  /** Active full-wall / focused view mode id. */
  stageTileId: string;
  activePluginId: string;
  /** Resolve plugin id for a mosaic tile (view mode id). */
  modeForTile: (tileId: string) => PresentTileMode;
}

/** Reused payload — host mutates fields; no per-frame object literals. */
const TICK: VizPresentTick = { frameMs: 0, tileId: "" };

let lastDeliveredFrameMs = -1;

/** Test hook: reset per-frame dedupe gate. */
export function resetPresentTickDeliveryForTests(): void {
  lastDeliveredFrameMs = -1;
}

function writeTick(frameMs: number, tileId: string, pluginClock?: number): VizPresentTick {
  TICK.frameMs = frameMs;
  TICK.tileId = tileId;
  if (pluginClock != null && Number.isFinite(pluginClock)) TICK.pluginClock = pluginClock;
  else delete TICK.pluginClock;
  return TICK;
}

export function presentTileIds(input: DeliverPresentTickInput): readonly string[] {
  if (!input.contract?.presentTick || !input.activePluginId) return [];
  if (!input.mosaicOn) return input.stageTileId ? [input.stageTileId] : [""];
  const out: string[] = [];
  for (let i = 0; i < input.tileIds.length; i++) {
    const id = input.tileIds[i]!;
    if (input.modeForTile(id).pluginId === input.activePluginId) out.push(id);
  }
  if (!out.length) out.push(input.stageTileId);
  return out;
}

/**
 * Deliver {@link VizPresentTick} to the plugin sandbox when the pack opted in.
 * At most one delivery wave per `frameMs`; one message per mosaic tile in that wave.
 */
export function deliverPluginPresentTicks(input: DeliverPresentTickInput): void {
  if (!input.contract?.presentTick) return;
  if (input.frameMs === lastDeliveredFrameMs) return;
  lastDeliveredFrameMs = input.frameMs;
  const tiles = presentTileIds(input);
  for (let i = 0; i < tiles.length; i++) {
    input.sandbox.present(writeTick(input.frameMs, tiles[i]!, input.pluginClock));
  }
}
