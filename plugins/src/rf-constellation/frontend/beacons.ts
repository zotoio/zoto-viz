import type { VizRfBeacon } from "../../../sdk/viz-contract";

/** Slot 0 layout the sky reads: [rssi, channel / 165, index / 8] per beacon, first 8 beacons.
 * The host's pack mirror (web/src/plugins/viz-pack-host.ts) writes the same layout. */
export function rfBeaconBuffer(beacons: readonly Pick<VizRfBeacon, "rssi" | "channel">[]): number[] {
  const buf: number[] = [];
  for (let i = 0; i < Math.min(8, beacons.length); i++) {
    const b = beacons[i]!;
    buf.push(b.rssi, b.channel / 165, i / 8);
  }
  return buf;
}
