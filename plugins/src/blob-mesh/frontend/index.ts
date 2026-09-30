
/** Metaball field — each talker is a blob (xy, radius, hue). */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";
import { packBlobMeshSlots } from "plugins/sdk/blob-mesh-budget";
const host = getVizZoto();

host.onFrame = (frame: VizDataFrame) => {
  // Radii: the floor for every drawn device, then one scale on the part above it so the mesh
  // stays inside the coverage budget (#174, plugins/sdk/blob-mesh-budget.ts). The host mirror
  // viz-pack-host.ts runPackFrameHandler("blob-mesh") writes the same slots from the same code.
  host.writeBuffer(0, packBlobMeshSlots(frame.talkers, frame.t).slot0);
  host.writeUniform("uBright", 0.8 + Math.min(0.35, (frame.talkers[0]?.rate ?? 0) / 80) + frame.audio * 0.2);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.25, 0.75, 0.95]);
};
