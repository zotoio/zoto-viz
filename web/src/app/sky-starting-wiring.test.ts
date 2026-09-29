import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const main = readFileSync(resolve(__dirname, "main.ts"), "utf8");
const between = (a: string, b: string) => main.slice(main.indexOf(a), main.indexOf(b, main.indexOf(a)));

describe("main.ts wires the sky wait (Starting… then couldn't start)", () => {
  it("loadPluginSkyOnto begins the wait before the fetch/compile, lands on success, cancels on error", () => {
    const body = between("async function installPluginSky(", "const skyWaitTiles");
    const begin = body.indexOf("beginSkyWait(waitKey");
    expect(begin).toBeGreaterThan(0);
    expect(begin).toBeLessThan(body.indexOf("fetchSkyOnce("));
    expect(body).toContain("landWhenDrawn(skyWaits, waitKey");
    expect(body).toMatch(/catch \(e\) \{\s*if \(waitKey\) skyWaits\.cancel\(waitKey\);/);
  });

  it("mosaic sync begins every waiting pack-sky pane before the sequential loads", () => {
    const body = between("async function syncPluginSky(", "function teardownMosaicPanelView(");
    expect(body.indexOf("beginSkyWait(id, target, pane, id)")).toBeGreaterThan(0);
    expect(body.indexOf("beginSkyWait(id, target, pane, id)")).toBeLessThan(body.indexOf("await loadPluginSkyOnto("));
  });

  it("tile health skips a tile that is starting or timed out", () => {
    expect(main).toContain("skyStarting: (id) => tileSkyStarting(id),");
    expect(between("function tileSkyStarting(", "async function syncPluginSky(")).toContain("skyWaits.exempt(key)");
  });
});
