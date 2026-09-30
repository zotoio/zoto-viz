
/** RF / SSID constellation: watch-list beacons go to slot 0 (one star each in the sky), plus sky uniforms. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { rfBeaconBuffer } from "./beacons";
import { getVizZoto } from "plugins/sdk/viz-zoto";
const host = getVizZoto();


host.onFrame = (frame) => {
  const beacons = frame.rf;
  host.writeBuffer(0, rfBeaconBuffer(beacons));
  const avg = beacons.reduce((s, b) => s + b.rssi, 0) / Math.max(1, beacons.length);
  host.writeUniform("uAudio", Math.min(1, frame.audio + avg * 0.25));
  host.writeUniform("uAccent", [0.2 + avg * 0.6, 0.45, 0.95 - avg * 0.3]);
  host.writeUniform("uOpacity", 0.65 + avg * 0.25);
};
