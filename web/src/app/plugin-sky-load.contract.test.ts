import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const mainSrc = readFileSync(resolve(import.meta.dirname, "main.ts"), "utf8");

function loadPluginSkyOntoBlock(): string {
  const start = mainSrc.indexOf("async function loadPluginSkyOnto");
  const end = mainSrc.indexOf("async function syncPluginSky", start);
  if (start < 0 || end < 0) throw new Error("loadPluginSkyOnto block missing");
  return mainSrc.slice(start, end);
}

describe("plugin sky load wiring", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("plugin-sky-mosaic-look", () => {
    expect(mainSrc.indexOf("import { Mosaic, mosaicPaneMode }")).toBeGreaterThan(-1);
    const block = loadPluginSkyOntoBlock();
    expect(block.indexOf("mosaicPaneMode(target.tileId)")).toBeGreaterThan(-1);
    expect(block.indexOf("optsFor(mosaicPaneMode(target.tileId))")).toBeGreaterThan(-1);
  });

  it("plugin-sky-load-wiring", () => {
    const block = loadPluginSkyOntoBlock();
    expect(block.indexOf("packId: spec.id")).toBeGreaterThan(-1);
    expect(block.indexOf("packKey:")).toBeGreaterThan(-1);
    expect(block.indexOf("isShaderPack: true")).toBeGreaterThan(-1);
    expect(block.indexOf("look: lookOpts")).toBeGreaterThan(-1);
    const errIdx = block.indexOf("if (err)");
    expect(errIdx).toBeGreaterThan(-1);
    const errBranch = block.slice(errIdx, block.indexOf("if (target === scene) skyLoaded = key", errIdx));
    expect(errBranch).not.toContain("setPluginShader(null)");
    const catchIdx = block.indexOf("} catch (e)");
    const catchBranch = block.slice(catchIdx, block.length);
    expect(catchBranch).not.toContain("setPluginShader(null)");
  });
});
