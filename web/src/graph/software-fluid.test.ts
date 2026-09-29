import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pluginShaderError, wrapPluginSky } from "../plugins/plugin-sky-probe";
import { fluidRgb, fluidSample } from "./software-fluid";

describe("software fluid", () => {
  it("paints ink on paper instead of the failed-sky navy", () => {
    const paper = fluidRgb(0, 0.7, 0, 0.85);
    expect(paper[0]).toBeGreaterThan(0.8);
    expect(paper[1]).toBeGreaterThan(0.8);
    const ink = fluidRgb(1, 0.7, 0, 0.85);
    const navy = (c: number[]) => c[0] < 0.08 && c[1] < 0.1 && c[2] < 0.15;
    expect(navy(ink)).toBe(false);
    expect(navy(paper)).toBe(false);
  });

  it("reads a live dye cell from the viz slots", () => {
    const flat = new Float32Array(512);
    flat[0] = 1;
    flat[2] = 0;
    flat[12] = 0.85;
    flat[14] = 10;
    flat[15] = 64;
    flat[64 + 5 * 10 + 5] = 1;
    flat[64 + 100 + 5 * 10 + 5] = 0.2;
    const slot = (buffer: number, index: number) => flat[buffer * 64 + index] ?? 0;
    const dyed = fluidSample(slot, 5.5 / 9, 5.5 / 9, 0);
    const empty = fluidSample(slot, 0.05, 0.05, 0);
    expect(empty[0]).toBeGreaterThan(dyed[0]);
    expect(dyed[2]).toBeGreaterThan(0.2);
  });

  it("ships a sky the host wrapper accepts", () => {
    const src = fs.readFileSync(
      path.join(import.meta.dirname, "../../../plugins/src/fluid-dyn/sky/fragment.glsl"),
      "utf8",
    );
    expect(pluginShaderError(src)).toBeNull();
    const wrapped = wrapPluginSky(src);
    expect("frag" in wrapped).toBe(true);
  });
});
