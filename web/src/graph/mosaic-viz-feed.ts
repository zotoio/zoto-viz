import type { ViewMode } from "../core/modes";
import type { Mosaic } from "./mosaic";
import type { NetScene } from "./scene";
import { vizContractFor, type PluginView } from "../plugins/plugin";
import { runPackFrameHandler, type VizPackHandlers } from "../plugins/viz-pack-host";
import { noteHostDirect, clearVizDrive } from "../plugins/viz-drive";
import { bindVizWriterCore, type VizBufferWriter, type VizDataFrame } from "../plugins/viz-host";
import { normalizeVizDemoPackId } from "../ui/viz-hud";

const tileWriters = new Map<string, VizBufferWriter>();

export function dropMosaicTileWriter(tileId: string): void {
  tileWriters.delete(tileId);
  clearVizDrive(tileId);
}

function writerForTile(tileId: string, spec: PluginView | null): VizBufferWriter | null {
  let writer = tileWriters.get(tileId);
  if (writer) return writer;
  if (!spec) return null;
  const contract = vizContractFor(spec);
  const { writer: w } = bindVizWriterCore(null, contract ?? undefined);
  if (!w) return null;
  tileWriters.set(tileId, w);
  return w;
}

function handlersFor(target: NetScene, writer: VizBufferWriter): VizPackHandlers {
  return {
    writeBuffer: (slot, data) => {
      if (writer.writeBuffer(slot, data).ok) target.setPluginUboBuffer(writer.ubo);
    },
    writeUniform: (name, value) => {
      if (writer.writeUniform(name, value).ok) target.setPluginUniform(name, value);
    },
    writeParticles: (data, stride) => {
      writer.writeParticles(data, stride);
      target.setPluginUboBuffer(writer.ubo);
    },
  };
}

/** Host-side demoscene packs: one UBO stream per mosaic tile (not only the header mode). */
export function deliverMosaicDemoPacks(
  mosaic: Mosaic,
  frame: VizDataFrame,
  modeById: (id: string) => ViewMode,
  pluginSpecForMode: (modeId: string) => PluginView | null,
  optsFor: (m: ViewMode) => Record<string, string>,
): void {
  for (const tileId of mosaic.tileIds) {
    const mode = modeById(tileId);
    const packId = normalizeVizDemoPackId(mode.pluginId);
    if (!packId) continue;
    const target = mosaic.graphScene(tileId);
    if (!target) continue;
    const spec = pluginSpecForMode(tileId);
    const writer = writerForTile(tileId, spec);
    if (!writer) continue;
    noteHostDirect(tileId);
    runPackFrameHandler(packId, frame, handlersFor(target, writer), optsFor(mode));
  }
}
