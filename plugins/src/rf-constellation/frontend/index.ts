
/** RF / SSID constellation bloom scaffold — maps watch-list beacons to sky uniforms. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "../../../sdk/viz-zoto";
const host = getVizZoto();


host.onFrame = (frame) => {
  const beacons = frame.rf;
  const buf: number[] = [];
  for (let i = 0; i < Math.min(8, beacons.length); i++) {
    const b = beacons[i]!;
    buf.push(b.rssi, b.channel / 165, i / 8);
  }
  host.writeBuffer(0, buf);
  const avg = beacons.reduce((s, b) => s + b.rssi, 0) / Math.max(1, beacons.length);
  host.writeUniform("uAudio", Math.min(1, frame.audio + avg * 0.25));
  host.writeUniform("uAccent", [0.2 + avg * 0.6, 0.45, 0.95 - avg * 0.3]);
  host.writeUniform("uOpacity", 0.65 + avg * 0.25);
};
