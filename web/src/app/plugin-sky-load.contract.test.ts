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

function loadTsPluginBlock(): string {
  const start = mainSrc.indexOf("async function loadTsPlugin");
  const end = mainSrc.indexOf("async function refreshTsPlugin", start);
  if (start < 0 || end < 0) throw new Error("loadTsPlugin block missing");
  return mainSrc.slice(start, end);
}

describe("plugin sky load wiring", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("plugin-sky-mosaic-look", () => {
    expect(mainSrc).toContain('from "../graph/mosaic"');
    const syncStart = mainSrc.indexOf("async function syncPluginSky");
    const syncEnd = mainSrc.indexOf("function teardownMosaicPanelView", syncStart);
    const sync = mainSrc.slice(syncStart, syncEnd);
    expect(sync).toContain("loadPluginSkyOnto(target, pane, wantPlugin, signal, id)");
  });

  it("plugin-sky-needs-review", () => {
    const block = loadPluginSkyOntoBlock();
    expect(block).toContain("markPluginNeedsReview(spec)");
    expect(block).toContain("console.warn");
    expect(block).toContain("paintPluginNeedsReviewNotice");
  });

  it("plugin-frontend-needs-review", () => {
    const block = loadTsPluginBlock();
    expect(block).toContain("markPluginNeedsReview(spec)");
    expect(block).toContain("console.warn");
    expect(block).toContain("paintPluginNeedsReviewNotice");
  });

  it("plugin-sky-load-wiring", () => {
    const block = loadPluginSkyOntoBlock();
    // One shared request per pack sky (fetchSkyOnce wraps fetchPluginSky).
    expect(block).toContain("fetchSkyOnce(spec.id");
    // Installed with its pack, so a failed compile reaches the tile as cant-draw / shader (#171 c / #179).
    expect(block).toContain("installTileSkyShader(target, spec, source, packKey)");
    expect(block).not.toContain("setPluginShader({ id: spec.id, source })");
    expect(block).toContain("spec.sky_error = err");
    expect(block).toContain("spec.sky_available = false");
  });
});
