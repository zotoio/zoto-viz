import type { VizDataFrame } from "./viz-host";
import type { VizPackFallbackText } from "../graph/tile-shader-fallback";
import { nixieFallbackText, parseNixieLook } from "../../../plugins/src/nixie-clock/frontend/tubes";
import { packetTunnelFallbackText } from "../../../plugins/src/packet-tunnel/frontend/tunnel";

const PACK_FALLBACK: Partial<Record<string, VizPackFallbackText>> = {
  "nixie-clock": (frame) => nixieFallbackText(new Date(frame.t * 1000), parseNixieLook()),
  "packet-tunnel": (frame) => packetTunnelFallbackText(frame),
};

export function packFallbackText(packId: string): VizPackFallbackText | undefined {
  return PACK_FALLBACK[packId];
}
