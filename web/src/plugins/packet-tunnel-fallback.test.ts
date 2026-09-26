import { beforeEach, describe, expect, it } from "vitest";
import { packetTunnelFallbackText } from "../../../plugins/src/packet-tunnel/frontend/tunnel";
import type { VizDataFrame } from "./viz-host";

function frameAt(tSec: number): VizDataFrame {
  return {
    t: tSec,
    dt: 0.016,
    audio: 0,
    packets: [],
    rf: [],
    talkers: [],
    headlines: [],
  };
}

describe("packet tunnel fallback text", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("tunnel-write-on-change", () => {
    let writes = 0;
    let last = "";
    for (let i = 0; i < 600; i++) {
      const next = packetTunnelFallbackText(frameAt(1000 + i * 0.016));
      if (next !== last) {
        writes++;
        last = next;
      }
    }
    expect(writes).toBe(27);
  });
});
