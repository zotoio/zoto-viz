import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKY_WAIT_DEADLINE_MS, SkyLoads, SkyWaits, landWhenDrawn, type SkyDrawnSource } from "./sky-wait";

class FakeTile implements SkyDrawnSource {
  pluginSkyDrawn: string | null = null;
  private cbs = new Set<(id: string) => void>();
  onPluginSkyDrawn(cb: (id: string) => void) { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  draw(id: string) { this.pluginSkyDrawn = id; for (const cb of [...this.cbs]) cb(id); }
  get listeners() { return this.cbs.size; }
}

function waitsOn(pane: HTMLElement, tile: FakeTile, retry = vi.fn()) {
  return new SkyWaits({ hostEl: () => pane, name: () => "Backrooms", skyReady: () => tile.pluginSkyDrawn === "backrooms", retry });
}

describe("sky wait lands on the first drawn frame, not the handover", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "info").mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

  it("QE row: sky handed over at 3.6s, drawn at 59s after a freeze; the card holds until the draw", () => {
    const pane = document.createElement("div");
    const tile = new FakeTile();
    const waits = waitsOn(pane, tile);
    waits.begin("k");
    vi.advanceTimersByTime(3_600);
    landWhenDrawn(waits, "k", tile, "backrooms"); // handover: shader installed, not drawn yet
    expect(waits.state("k")).toBe("starting");
    expect(pane.querySelector(".sky-starting-card.fading")).toBeNull();
    vi.advanceTimersByTime(40_000); // still inside the deadline, still not drawn
    expect(waits.state("k")).toBe("starting");
    tile.draw("backrooms");
    expect(waits.state("k")).toBeNull();
    expect(pane.querySelector(".sky-starting-card.fading")).not.toBeNull();
    expect(tile.listeners).toBe(0);
  });

  it("the deadline's on-screen check reads the drawn sky, so handed-over-but-undrawn still times out", () => {
    const pane = document.createElement("div");
    const tile = new FakeTile();
    const waits = waitsOn(pane, tile);
    waits.begin("k");
    landWhenDrawn(waits, "k", tile, "backrooms");
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    expect(waits.state("k")).toBe("failed:timeout");
  });

  it("a frame drawn with a different sky does not land the wait", () => {
    const pane = document.createElement("div");
    const tile = new FakeTile();
    const waits = waitsOn(pane, tile);
    waits.begin("k");
    landWhenDrawn(waits, "k", tile, "backrooms");
    tile.draw("other");
    expect(waits.state("k")).toBe("starting");
  });
});

describe("SkyLoads: one sky request per tile", () => {
  it("three concurrent syncs for the same sky make 1 request", async () => {
    const loads = new SkyLoads<object>();
    const tile = {};
    const sig = new AbortController().signal;
    let requests = 0;
    let finish!: () => void;
    const start = () => { requests++; return new Promise<void>((r) => { finish = r; }); };
    const a = loads.share(tile, "backrooms:abc", sig, start);
    const b = loads.share(tile, "backrooms:abc", sig, start);
    const c = loads.share(tile, "backrooms:abc", sig, start);
    expect(requests).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
    finish();
    await a;
  });

  it("another tile, another sky, or an aborted load starts its own request", () => {
    const loads = new SkyLoads<object>();
    const t1 = {}, t2 = {};
    const ac = new AbortController();
    let requests = 0;
    const start = () => { requests++; return new Promise<void>(() => {}); };
    loads.share(t1, "backrooms:abc", ac.signal, start);
    loads.share(t2, "backrooms:abc", ac.signal, start);
    loads.share(t1, "nixie:def", ac.signal, start);
    ac.abort();
    loads.share(t1, "nixie:def", new AbortController().signal, start);
    expect(requests).toBe(4);
  });

  it("Retry (forget) starts 1 fresh request and the stuck one no longer installs", () => {
    const loads = new SkyLoads<object>();
    const tile = {};
    const sig = new AbortController().signal;
    const currents: (() => boolean)[] = [];
    const start = (current: () => boolean) => { currents.push(current); return new Promise<void>(() => {}); };
    loads.share(tile, "backrooms:abc", sig, start);
    loads.forget(tile);
    loads.share(tile, "backrooms:abc", sig, start);
    expect(currents.length).toBe(2);
    expect(currents[0]!()).toBe(false);
    expect(currents[1]!()).toBe(true);
  });
});

describe("Retry is a real, reachable button on a click-through notice", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "info").mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

  function timedOut() {
    const pane = document.createElement("div");
    document.body.append(pane);
    const tile = new FakeTile();
    const retry = vi.fn();
    const waits = waitsOn(pane, tile, (k: string) => { retry(k); waits.begin(k); });
    waits.begin("k");
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    const notice = pane.querySelector<HTMLElement>(".mosaic-pane-notice")!;
    const btn = notice.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry")!;
    return { waits, retry, notice, btn };
  }

  it("notice announces with role=status; Retry is a focusable <button>", () => {
    const { notice, btn } = timedOut();
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.getAttribute("aria-live")).toBe("polite");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.type).toBe("button");
    expect(btn.tabIndex).toBe(0);
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it("a pointer click on Retry retries once and restarts the countdown", () => {
    const { waits, retry, btn } = timedOut();
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(waits.state("k")).toBe("starting");
  });

  it("CSS: the notice is click-through, only its buttons take the pointer, and they show a focus ring", () => {
    const css = readFileSync(resolve(__dirname, "../style.css"), "utf8");
    expect(css).toMatch(/\.mosaic-pane-notice \.mosaic-pane-notice-retry,\s*\.mosaic-pane-notice \.mosaic-pane-notice-remove \{ pointer-events: auto; \}/);
    expect(css).toMatch(/\.mosaic-pane-notice-retry:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--accent\)/);
    const last = css.lastIndexOf(".mosaic-pane-notice {");
    expect(css.slice(last, css.indexOf("}", last))).toContain("pointer-events: none");
  });
});

describe("scene reports the first frame drawn with the sky", () => {
  const scene = readFileSync(resolve(__dirname, "../graph/scene.ts"), "utf8");
  it("the signal fires after the render call, and every install re-arms it", () => {
    const present = scene.slice(scene.indexOf("  private present("), scene.indexOf("  private notePaneChange("));
    expect(present.indexOf("this.skyDrawn.frame();")).toBeGreaterThan(present.indexOf("this.renderer.render("));
    const set = scene.slice(scene.indexOf("  setPluginShader("), scene.indexOf("return this.backdrop.setPluginShader(opts, gpuProbe);"));
    expect(set).toContain("this.skyDrawn.arm(!!opts);");
  });
  it("main.ts lands the wait on the drawn frame and dedupes the request", () => {
    const main = readFileSync(resolve(__dirname, "main.ts"), "utf8");
    expect(main).toContain("landWhenDrawn(skyWaits, waitKey, target, spec.id)");
    expect(main).toContain("skyLoads.share(target, packKey, signal,");
    expect(main).toContain("w.target.pluginSkyDrawn === w.spec.id");
    expect(main).not.toMatch(/skyWaits\.landed\(waitKey\)/);
    const install = main.slice(main.indexOf("async function installPluginSky("), main.indexOf("const skyWaitTiles"));
    expect(install).toContain("await fetchSkyOnce(spec.id, spec.shader_sha256)");
    expect(install).not.toContain("fetchPluginSky(");
  });
});

describe("Retry press is not taken by the tile's camera handlers", () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

  it("isOverlayControl is true for the notice buttons and false for the canvas", async () => {
    const { isOverlayControl } = await import("../graph/scene");
    const { paintPackAssetPaneNotice } = await import("../plugins/pack-asset-pane-notice");
    const pane = document.createElement("div");
    const canvas = document.createElement("canvas");
    pane.append(canvas);
    paintPackAssetPaneNotice(pane, "Backrooms couldn't start.", "fail", { showRetry: true, onRetry: () => {} });
    const btn = pane.querySelector(".mosaic-pane-notice-retry");
    expect(isOverlayControl(btn)).toBe(true);
    expect(isOverlayControl(btn?.firstChild ?? null)).toBe(false); // text node: not an Element
    expect(isOverlayControl(canvas)).toBe(false);
    expect(isOverlayControl(pane.querySelector(".mosaic-pane-notice-text"))).toBe(false);
  });

  it("pointerdown on Retry does not reach a bubbling orbit handler on the tile", async () => {
    const { paintPackAssetPaneNotice } = await import("../plugins/pack-asset-pane-notice");
    const pane = document.createElement("div");
    document.body.append(pane);
    const orbit = vi.fn();
    pane.addEventListener("pointerdown", orbit);
    const onRetry = vi.fn();
    paintPackAssetPaneNotice(pane, "Backrooms couldn't start.", "fail", { showRetry: true, onRetry });
    const btn = pane.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry")!;
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(orbit).not.toHaveBeenCalled();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("scene's capture-phase pointerdown returns early on overlay controls", () => {
    const scene = readFileSync(resolve(__dirname, "../graph/scene.ts"), "utf8");
    const i = scene.indexOf('this.inputEl.addEventListener("pointerdown", (e) => {');
    expect(scene.slice(i, i + 400)).toContain("if (isOverlayControl(e.target)) return;");
  });
});
