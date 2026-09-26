import type { ViewMode } from "../core/modes";
import type { Mosaic } from "./mosaic";
import type { NetScene } from "./scene";
import { mosaicPlacedTileIndices, mosaicTileViewId } from "./mosaic-tile-id";
import { normalizeVizDemoPackId, type VizDemoPackId } from "../ui/viz-hud";
import { runPackFrameHandler, type VizPackHandlers } from "../plugins/viz-pack-host";
import type { PluginView } from "../plugins/plugin";
import {
  bindVizWriterCore,
  VizFrameBudget,
  type VizBufferWriter,
  type VizDataFrame,
  type VizFrameBudgetStats,
} from "../plugins/viz-host";
import { vizContractFor } from "../plugins/plugin";

export type PackGroupKey = string;

export type MosaicPackGroup = {
  key: PackGroupKey;
  packId: VizDemoPackId | null;
  pluginId: string | null;
  primarySlot: string;
  slots: string[];
};

export function packGroupKeyForMode(mode: ViewMode): PackGroupKey | null {
  const demo = normalizeVizDemoPackId(mode.pluginId);
  if (demo) return `demo:${demo}`;
  if (mode.pluginId) return `plugin:${mode.pluginId}`;
  return null;
}

export function mosaicPackGroups(
  tileSlotIds: readonly string[],
  modeById: (viewId: string) => ViewMode,
): MosaicPackGroup[] {
  const order: PackGroupKey[] = [];
  const map = new Map<PackGroupKey, string[]>();
  for (const slot of tileSlotIds) {
    const viewId = mosaicTileViewId(slot);
    const key = packGroupKeyForMode(modeById(viewId));
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(slot);
  }
  return order.map((key) => {
    const slots = map.get(key)!;
    const primarySlot = slots[0]!;
    const mode = modeById(mosaicTileViewId(primarySlot));
    return {
      key,
      packId: normalizeVizDemoPackId(mode.pluginId),
      pluginId: mode.pluginId ?? null,
      primarySlot,
      slots,
    };
  });
}

export function primaryTileIndex(tileSlotIds: readonly string[], viewId: string): number {
  return mosaicPlacedTileIndices(tileSlotIds, viewId)[0] ?? 1;
}

const groupWriters = new Map<PackGroupKey, VizBufferWriter>();
const packBudgets = new Map<PackGroupKey, VizFrameBudget>();

export function resetMosaicPackCoalesceWriters(): void {
  groupWriters.clear();
  packBudgets.clear();
}

/** Per-pack handler timing for mosaic HUD (skip rate still follows the shared viz budget). */
export function mosaicPackHudStats(key: PackGroupKey): VizFrameBudgetStats | null {
  return packBudgets.get(key)?.stats ?? null;
}

function writerForGroup(key: PackGroupKey, spec: PluginView | null): VizBufferWriter | null {
  let writer = groupWriters.get(key);
  if (writer) return writer;
  if (!spec) return null;
  const contract = vizContractFor(spec);
  const { writer: w } = bindVizWriterCore(null, contract ?? undefined);
  if (!w) return null;
  groupWriters.set(key, w);
  return w;
}

export type MosaicPackBudget = {
  stats: VizFrameBudgetStats;
};

export function deliverCoalescedMosaicPacks(input: {
  mosaic: Pick<Mosaic, "tileIds" | "graphScene">;
  frame: VizDataFrame;
  modeById: (viewId: string) => ViewMode;
  pluginSpecForMode: (modeId: string) => PluginView | null;
  optsFor: (m: ViewMode) => Record<string, string>;
  budget: MosaicPackBudget;
  onSandboxFrame?: (pluginId: string, frame: VizDataFrame) => void;
}): void {
  const groups = mosaicPackGroups(input.mosaic.tileIds, input.modeById);
  for (const group of groups) {
    const primary = input.mosaic.graphScene(group.primarySlot);
    if (!primary) continue;
    const viewId = mosaicTileViewId(group.primarySlot);
    const mode = input.modeById(viewId);
    const spec = input.pluginSpecForMode(viewId);
    const writer = writerForGroup(group.key, spec);
    if (!writer || !group.packId) continue;

    const handlers: VizPackHandlers = {
      writeBuffer: (slot, data) => {
        if (writer.writeBuffer(slot, data).ok) primary.setPluginUboBuffer(writer.ubo);
      },
      writeUniform: (name, value) => {
        if (writer.writeUniform(name, value).ok) primary.setPluginUniform(name, value);
      },
      writeParticles: (data, stride) => {
        writer.writeParticles(data, stride);
        primary.setPluginUboBuffer(writer.ubo);
      },
    };

    let budget = packBudgets.get(group.key);
    if (!budget) {
      budget = new VizFrameBudget();
      packBudgets.set(group.key, budget);
    }
    const t0 = performance.now();
    runPackFrameHandler(group.packId, input.frame, handlers, input.optsFor(mode));
    budget.record(performance.now() - t0);
    if (group.pluginId) input.onSandboxFrame?.(group.pluginId, input.frame);

    const ubo = writer.ubo;
    for (const slot of group.slots) {
      const scene = input.mosaic.graphScene(slot);
      if (scene) scene.setPluginUboBuffer(ubo);
    }
  }
}

export function applyPackCoalesceLayout(
  mosaic: Pick<Mosaic, "tileIds" | "graphScene">,
  modeById: (viewId: string) => ViewMode,
): void {
  const groups = mosaicPackGroups(mosaic.tileIds, modeById);
  const grouped = new Set<string>();
  for (const g of groups) {
    const primary = mosaic.graphScene(g.primarySlot);
    const viewId = mosaicTileViewId(g.primarySlot);
    const mode = modeById(viewId);
    const mirrorKind: "hostCanvas" | "sandboxSurface" = g.packId ? "hostCanvas" : "sandboxSurface";
    const packLabel = mode.label ?? g.pluginId ?? "pack";
    const mirrorsTile = mosaic.tileIds.indexOf(g.primarySlot) + 1;
    const coalesceBase = {
      mirrorKind,
      pluginId: g.pluginId ?? undefined,
      packLabel,
      tileCount: g.slots.length,
    };
    for (const slot of g.slots) {
      grouped.add(slot);
      const scene = mosaic.graphScene(slot);
      if (!scene) continue;
      if (slot === g.primarySlot) scene.setPackCoalesce({ role: "primary", primary: null, ...coalesceBase });
      else scene.setPackCoalesce({ role: "mirror", primary: primary ?? null, ...coalesceBase, mirrorsTile });
    }
  }
  for (const slot of mosaic.tileIds) {
    if (!grouped.has(slot)) mosaic.graphScene(slot)?.setPackCoalesce(null);
  }
}
