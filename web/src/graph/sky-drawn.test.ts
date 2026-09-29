import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SkyWaits, landWhenDrawn } from "../app/sky-wait";
import { SkyDrawnSignal } from "./sky-drawn";

/** A tile as the render loop sees it: installed sky id plus the one-shot signal. */
function tile() {
  let sky: string | null = null;
  const sig = new SkyDrawnSignal(() => sky);
  return {
    sig,
    install(id: string | null) { sig.arm(id !== null); sky = id; },
    showSky(id: string | null) { sky = id; },
    frame() { sig.frame(); },
    source: { get pluginSkyDrawn() { return sig.drawn(sky); }, onPluginSkyDrawn: (cb: (id: string) => void) => sig.on(cb) },
  };
}

function waitsFor(pane: HTMLElement) {
  return new SkyWaits({ hostEl: () => pane, name: () => "Backrooms", skyReady: () => false, retry: () => {} });
}

describe("first-frame-drawn signal is one-shot (Pedant count rows)", () => {
  it("600 frames after ready: exactly 1 event, 0 sky-id reads after it, listener removed", () => {
    const t = tile();
    const pane = document.createElement("div");
    const waits = waitsFor(pane);
    let events = 0;
    t.sig.on(() => { events++; });
    waits.begin("main");
    t.install("backrooms");
    landWhenDrawn(waits, "main", t.source, "backrooms");
    expect(t.sig.listenerCount).toBe(2);
    t.frame(); // first frame drawn with the sky
    expect(events).toBe(1);
    expect(waits.state("main")).toBeNull();
    expect(t.sig.listenerCount).toBe(1); // the wait's listener removed itself
    const checksAtReady = t.sig.checks;
    for (let i = 0; i < 600; i++) t.frame();
    expect(events).toBe(1);
    expect(t.sig.checks - checksAtReady).toBe(0);
    expect(t.source.pluginSkyDrawn).toBe("backrooms");
  });

  it("2x2: 4 panes, 4 one-shot events, then 0 per-frame checks and 0 listeners", () => {
    const tiles = [tile(), tile(), tile(), tile()];
    const pane = document.createElement("div");
    const waits = waitsFor(pane);
    tiles.forEach((t, i) => {
      waits.begin(`p${i}`);
      t.install("backrooms");
      landWhenDrawn(waits, `p${i}`, t.source, "backrooms");
    });
    for (const t of tiles) t.frame();
    expect(tiles.map((t) => t.sig.checks)).toEqual([1, 1, 1, 1]);
    expect(tiles.map((t) => t.sig.listenerCount)).toEqual([0, 0, 0, 0]);
    for (let f = 0; f < 600; f++) for (const t of tiles) t.frame();
    expect(tiles.map((t) => t.sig.checks)).toEqual([1, 1, 1, 1]);
    expect(tiles.every((t) => t.source.pluginSkyDrawn === "backrooms")).toBe(true);
  });

  it("a reinstall re-arms once; a clear reports nothing drawn", () => {
    const t = tile();
    t.install("backrooms");
    t.frame();
    t.install("backrooms");
    expect(t.source.pluginSkyDrawn).toBeNull();
    t.frame();
    expect(t.source.pluginSkyDrawn).toBe("backrooms");
    t.install(null);
    for (let i = 0; i < 600; i++) t.frame();
    expect(t.source.pluginSkyDrawn).toBeNull();
    expect(t.sig.checks).toBe(2); // a cleared tile is disarmed: no per-frame reads
  });

  it("installed before the backdrop switches to it: stays armed, fires on the first frame it's shown", () => {
    const t = tile();
    let events = 0;
    t.sig.on(() => { events++; });
    t.install("backrooms");
    t.showSky(null); // installed, but the tile still draws another backdrop
    t.frame();
    t.frame();
    expect(events).toBe(0);
    t.showSky("backrooms");
    t.frame();
    for (let i = 0; i < 600; i++) t.frame();
    expect(events).toBe(1);
    expect(t.sig.checks).toBe(3);
  });

  it("never touches the GPU: no finish, readPixels or fence in the signal or its scene hook", () => {
    const src = readFileSync(resolve(__dirname, "sky-drawn.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/\.finish\(|readPixels|fenceSync|clientWaitSync|getSyncParameter/);
    const scene = readFileSync(resolve(__dirname, "scene.ts"), "utf8");
    const present = scene.slice(scene.indexOf("  private present("), scene.indexOf("  private notePaneChange("));
    expect(present).toContain("this.skyDrawn.frame();");
    expect(present.indexOf("this.skyDrawn.frame();")).toBeGreaterThan(present.indexOf("this.renderer.render("));
  });
});
