import { beforeEach, describe, expect, it } from "vitest";
import { nixieFallbackText, parseNixieLook } from "../../../plugins/src/nixie-clock/frontend/tubes";
import { TileShaderFallback } from "../graph/tile-shader-fallback";
import type { VizDataFrame } from "./viz-host";

function frameAt(ms: number): VizDataFrame {
  return {
    t: ms / 1000,
    dt: 0.016,
    audio: 0,
    packets: [],
    rf: [],
    talkers: [],
    headlines: [],
  };
}

describe("nixie shader fallback text", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("nixie-text", () => {
    const at105 = new Date(2026, 0, 1, 1, 5, 0, 0);
    expect(nixieFallbackText(at105, parseNixieLook({ format: "24", seconds: "1" }))).toBe("01 05 00");
    const midnight = new Date(2026, 0, 1, 0, 0, 0, 0);
    expect(nixieFallbackText(midnight, parseNixieLook({ format: "12", seconds: "0" }))).toBe("12 00");
  });

  it("nixie-write-on-change", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const look = parseNixieLook({ format: "24", seconds: "1" });
    const fb = new TileShaderFallback(mount, {
      packName: "Nixie Clock",
      fallbackText: (f) => nixieFallbackText(new Date(f.t * 1000), look),
    });
    const node = fb.textNode;
    expect(node.isConnected).toBe(true);
    expect(node).toBe(mount.querySelector(".tile-shader-fallback__text"));
    let writes = 0;
    const desc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    Object.defineProperty(node, "textContent", {
      configurable: true,
      get: () => desc.get!.call(node),
      set(v: string) {
        writes++;
        desc.set!.call(node, v);
      },
    });
    const t0 = new Date(2026, 0, 1, 1, 5, 0, 0).getTime();
    for (let i = 0; i < 600; i++) {
      fb.frame(frameAt(t0 + i * 16));
    }
    expect(writes).toBe(10);
    expect(node).toBe(mount.querySelector(".tile-shader-fallback__text"));

    writes = 0;
    const lookNoSec = parseNixieLook({ format: "24", seconds: "0" });
    const fb2 = new TileShaderFallback(mount, {
      packName: "Nixie Clock",
      fallbackText: (f) => nixieFallbackText(new Date(f.t * 1000), lookNoSec),
    });
    const node2 = fb2.textNode;
    Object.defineProperty(node2, "textContent", {
      configurable: true,
      get: () => desc.get!.call(node2),
      set(v: string) {
        writes++;
        desc.set!.call(node2, v);
      },
    });
    for (let i = 0; i < 600; i++) {
      fb2.frame(frameAt(t0 + i * 16));
    }
    expect(writes).toBe(1);
    mount.remove();
  });
});
