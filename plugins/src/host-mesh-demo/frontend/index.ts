import type { VizDataFrame, VizPresentTick } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";
import { encodeHostMeshSlotPacket } from "../../../sdk/host-mesh-frame";

const host = getVizZoto();

let t = 0;

/**
 * The fixture triangle is 1 m across. This pack has no stage-mesh camera, so it is drawn by the
 * default stage camera: NetScene's orbit at (0, 820, 820) around the origin, levelled to the
 * horizon for stageOnly views, about 1160 m out. At that distance a 0.35 m triangle at z -1.2 is
 * under a thousandth of the view, so the scale is world-sized and the triangle sits on the target.
 */
const MESH_SCALE = 300;
const MESH_PULSE = 85;

function matrixSlot(clock: number): number[] {
  const s = MESH_SCALE + Math.sin(clock * 0.7) * MESH_PULSE;
  const c = Math.cos(clock * 0.4);
  const si = Math.sin(clock * 0.4);
  // column-major 4×4: Y spin + uniform scale, centred on the camera target
  return [
    s * c, 0, s * si, 0,
    0, s, 0, 0,
    -s * si, 0, s * c, 0,
    0, 0, 0, 1,
  ];
}

host.onFrame = (frame: VizDataFrame) => {
  t = frame.t;
};

host.onPresent = (tick: VizPresentTick) => {
  const clock = typeof tick.pluginClock === "number" ? tick.pluginClock : t + tick.frameMs * 0.001;
  // v2 packet (header 2, asset 0, one instance). A bare 16-float matrix is ambiguous: its first
  // value s·cos can round to 2 and read as a v2 header, and the host then refuses the write.
  host.writeBuffer(2, encodeHostMeshSlotPacket(0, [{ matrix: matrixSlot(clock) }]));
  host.writeUniform("uBright", 0.95);
  host.writeUniform("uOpacity", 1);
};
