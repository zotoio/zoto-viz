
/** Metaball field — each talker is a blob (xy, radius, hue). */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";
import { packBlobMeshSlots, type BlobMeshSiteMap } from "plugins/sdk/blob-mesh-budget";
const host = getVizZoto();
/** #193: which lattice site each of the busiest 4 devices holds, kept across frames. */
const sites: BlobMeshSiteMap = new Map();

host.onFrame = (frame: VizDataFrame) => {
  // Radii: the floor for every drawn device, then one scale on the part above it so the mesh
  // stays inside the coverage budget (#174, plugins/sdk/blob-mesh-budget.ts). The host mirror
  // viz-pack-host.ts runPackFrameHandler("blob-mesh") writes the same slots from the same code.
  host.writeBuffer(0, packBlobMeshSlots(frame.talkers, frame.t, sites).slot0);
  host.writeUniform("uBright", 0.8 + frame.audio * 0.2); // #174 UX Pro: size is the only rate signal, no rate term
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.25, 0.75, 0.95]);
};
