import type { VizDataFrame } from "./viz-host";
import type { VizPackFallbackText } from "../graph/tile-shader-fallback";
import { formatNixieFallbackLine, parseNixieLook } from "../../../plugins/src/nixie-clock/frontend/tubes";
import { packetTunnelFallbackText } from "../../../plugins/src/packet-tunnel/frontend/tunnel";

function nixiePackFallback(look?: Record<string, string> | null): VizPackFallbackText {
  const parsed = parseNixieLook(look);
  const scratch = { h: 0, m: 0, s: 0 };
  const cache = { key: -1, text: "" };
  const date = new Date(0);
  return (frame: VizDataFrame) => {
    date.setTime(frame.t * 1000);
    return formatNixieFallbackLine(date, parsed, scratch, cache);
  };
}

/** One closure per tile at mount; `look` is parsed once for nixie-clock. */
export function packFallbackText(
  packId: string,
  look?: Record<string, string> | null,
): VizPackFallbackText | undefined {
  if (packId === "nixie-clock") return nixiePackFallback(look);
  if (packId === "packet-tunnel") return (frame) => packetTunnelFallbackText(frame);
  return undefined;
}
