import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkyWaits, landWhenDrawn } from "../app/sky-wait";
import { skyStartingShown } from "./sky-starting-card";
import { SkyDrawnSignal } from "./sky-drawn";

/**
 * Fake GL + fake presentation. A draw only queues work; while the sky program's compile is still
 * pending the frame is not presented, so the browser runs no further animation-frame callbacks.
 * Every GPU wait call the signal could use is a spy, so the counts below are runtime call counts.
 */
function fakeGl() {
  const gl = {
    drawArrays: vi.fn(),
    finish: vi.fn(),
    flush: vi.fn(),
    readPixels: vi.fn(),
    fenceSync: vi.fn(() => ({})),
    clientWaitSync: vi.fn(() => 0x911a),
    getSyncParameter: vi.fn(),
    getProgramParameter: vi.fn(() => true),
  };
  const waitsOnGpu = () =>
    gl.finish.mock.calls.length + gl.readPixels.mock.calls.length + gl.fenceSync.mock.calls.length +
    gl.clientWaitSync.mock.calls.length + gl.getSyncParameter.mock.calls.length + gl.getProgramParameter.mock.calls.length;
  return { gl, waitsOnGpu };
}

/** One tile: installed sky id, the signal, a render loop that draws through the fake GL. */
function tile(gl: ReturnType<typeof fakeGl>["gl"]) {
  let sky: string | null = null;
  let compilePending = false;
  const raf: (() => void)[] = [];
  const sig = new SkyDrawnSignal(() => sky, (cb) => { raf.push(cb); });
  return {
    sig,
    install(id: string | null, pendingCompile = true) { sig.arm(id !== null); sky = id; compilePending = id !== null && pendingCompile; },
    showSky(id: string | null) { sky = id; },
    /** The render loop's frame: draw (queued, not executed), then the signal's hook. */
    draw() { gl.drawArrays(); sig.frame(); },
    compileDone() { compilePending = false; },
    /** The browser presents the frame and runs the next animation-frame callbacks, unless blocked. */
    present() {
      if (compilePending) return false;
      for (const cb of raf.splice(0)) cb();
      return true;
    },
    /** A whole frame: draw, then present if the GPU let it through. */
    frame() { this.draw(); this.present(); },
    rafQueued: () => raf.length,
    source: { get pluginSkyDrawn() { return sig.drawn(sky); }, onPluginSkyDrawn: (cb: (id: string) => void) => sig.on(cb) },
  };
}

function waitsFor(pane: HTMLElement) {
  return new SkyWaits({ hostEl: () => pane, name: () => "Backrooms", skyReady: () => false, retry: () => {} });
}

describe("first-frame signal fires after presentation, not the draw (fake GL behaviour rows)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a draw with the compile still pending keeps the card; it clears only once the frame is presented", () => {
    const { gl, waitsOnGpu } = fakeGl();
    const t = tile(gl);
    const pane = document.createElement("div");
    const waits = waitsFor(pane);
    waits.begin("main");
    t.install("backrooms", true);
    landWhenDrawn(waits, "main", t.source, "backrooms");
    t.draw(); // first draw with the sky: queued behind the compile
    for (let i = 0; i < 5; i++) expect(t.present()).toBe(false);
    expect(waits.state("main")).toBe("starting");
    expect(skyStartingShown(pane)).toBe(true);
    expect(t.source.pluginSkyDrawn).toBeNull();
    t.compileDone();
    expect(t.present()).toBe(true);
    expect(waits.state("main")).toBeNull();
    expect(skyStartingShown(pane)).toBe(false); // fading
    expect(t.source.pluginSkyDrawn).toBe("backrooms");
    expect(waitsOnGpu()).toBe(0);
  });

  it("Pedant row, single view: 600 frames after ready give 1 event, 0 reads, 0 GPU waits, listener removed", () => {
    const { gl, waitsOnGpu } = fakeGl();
    const t = tile(gl);
    const pane = document.createElement("div");
    const waits = waitsFor(pane);
    let events = 0;
    t.sig.on(() => { events++; });
    waits.begin("main");
    t.install("backrooms", false);
    landWhenDrawn(waits, "main", t.source, "backrooms");
    expect(t.sig.listenerCount).toBe(2);
    t.frame();
    expect(events).toBe(1);
    expect(waits.state("main")).toBeNull();
    expect(t.sig.listenerCount).toBe(1); // the wait's listener removed itself
    const checksAtReady = t.sig.checks;
    for (let i = 0; i < 600; i++) t.frame();
    expect(events).toBe(1);
    expect(t.sig.checks - checksAtReady).toBe(0);
    expect(t.sig.scheduled).toBe(1);
    expect(t.rafQueued()).toBe(0);
    expect(gl.drawArrays).toHaveBeenCalledTimes(601);
    expect(waitsOnGpu()).toBe(0);
  });

  it("Pedant row, 2x2: 4 panes give 4 one-shot events, then 0 reads, 0 listeners, 0 GPU waits", () => {
    const { gl, waitsOnGpu } = fakeGl();
    const tiles = [tile(gl), tile(gl), tile(gl), tile(gl)];
    const pane = document.createElement("div");
    const waits = waitsFor(pane);
    tiles.forEach((t, i) => {
      waits.begin(`p${i}`);
      t.install("backrooms", true);
      landWhenDrawn(waits, `p${i}`, t.source, "backrooms");
    });
    for (const t of tiles) t.draw();
    expect(waits.keys().length).toBe(4); // compiles pending: every pane keeps its card
    for (const t of tiles) { t.compileDone(); t.present(); }
    expect(waits.keys().length).toBe(0);
    expect(tiles.map((t) => t.sig.checks)).toEqual([1, 1, 1, 1]);
    expect(tiles.map((t) => t.sig.listenerCount)).toEqual([0, 0, 0, 0]);
    for (let f = 0; f < 600; f++) for (const t of tiles) t.frame();
    expect(tiles.map((t) => t.sig.checks)).toEqual([1, 1, 1, 1]);
    expect(tiles.map((t) => t.sig.scheduled)).toEqual([1, 1, 1, 1]);
    expect(tiles.every((t) => t.source.pluginSkyDrawn === "backrooms")).toBe(true);
    expect(waitsOnGpu()).toBe(0);
  });

  it("a reinstall before presentation drops the old callback; the new install fires once", () => {
    const { gl } = fakeGl();
    const t = tile(gl);
    let events = 0;
    t.sig.on(() => { events++; });
    t.install("backrooms", true);
    t.draw();
    t.install("backrooms", false); // Retry: new program
    t.present(); // the old install's callback runs and does nothing
    expect(events).toBe(0);
    t.frame();
    expect(events).toBe(1);
  });

  it("a clear reports nothing drawn and does no per-frame reads", () => {
    const { gl } = fakeGl();
    const t = tile(gl);
    t.install("backrooms", false);
    t.frame();
    t.install(null);
    for (let i = 0; i < 600; i++) t.frame();
    expect(t.source.pluginSkyDrawn).toBeNull();
    expect(t.sig.checks).toBe(1);
  });

  it("installed before the backdrop switches to it: stays armed, fires on the first presented frame with it", () => {
    const { gl } = fakeGl();
    const t = tile(gl);
    let events = 0;
    t.sig.on(() => { events++; });
    t.install("backrooms", false);
    t.showSky(null);
    t.frame();
    t.frame();
    expect(events).toBe(0);
    t.showSky("backrooms");
    for (let i = 0; i < 600; i++) t.frame();
    expect(events).toBe(1);
    expect(t.sig.checks).toBe(3);
  });

  it("scene hook: present() runs the signal after the render call", () => {
    const scene = readFileSync(resolve(__dirname, "scene.ts"), "utf8");
    const present = scene.slice(scene.indexOf("  private present("), scene.indexOf("  private notePaneChange("));
    expect(present).toContain("this.skyDrawn.frame();");
    expect(present.indexOf("this.skyDrawn.frame();")).toBeGreaterThan(present.indexOf("this.renderer.render("));
  });
});
