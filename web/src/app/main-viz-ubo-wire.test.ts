import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** QE row: main.ts hunks that route UBO through broadcastPluginUbo (F1 / mosaic). */
describe("main viz UBO broadcast wiring", () => {
  it("afterLook and sandbox writeBuffer use broadcastPluginUbo", () => {
    const src = readFileSync(resolve(import.meta.dirname, "main.ts"), "utf8");
    const hits = src.match(/broadcastPluginUbo\(scene, vizWriter\.ubo/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(
      /if \(vizWriter\?\.writeBuffer\(slot, data\)\.ok\) broadcastPluginUbo\(scene, vizWriter\.ubo/,
    );
  });
});
