/**
 * #179: the shared host recovers from a lost WebGL context during a Backrooms boot, the tile is
 * never left dead, and later view picks still land and draw. Includes Fractal zoom's host row 4
 * (restored, then lost again with no browser restore) and a dispose-while-lost row.
 *
 * The fake context follows Chrome's rules for `WEBGL_lose_context`:
 * - `loseContext()` marks the context lost now and dispatches `webglcontextlost` from a queued task;
 * - `restoreContext()` is refused (INVALID_OPERATION) unless that event has already been dispatched
 *   and default-prevented; an accepted restore dispatches `webglcontextrestored` from a queued task;
 * - a browser-side loss may or may not be restorable, and may or may not auto-restore.
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetScene } from "./scene";
import { RenderHost, type HostedView } from "./render-host";
import { GFX_INTERRUPTED_NOTICE, GFX_NO_RESTORE_NOTICE } from "./shader-fallback-copy";
import { SandboxBitmapGl } from "./pack-mirror-gl";
import { surfaceLetterboxFill } from "./letterbox-fill";

const SKY = `
void main() {
  vec3 dir = normalize(vDir);
  fragColor = vec4(dir, 1.0);
}
`;

const BACKROOMS = { id: "backrooms", meta: { packId: "backrooms", packName: "NET Backrooms", packKey: "plugin:backrooms" } };
const FRACTAL = { id: "fractal-zoom", meta: { packId: "fractal-zoom", packName: "Fractal zoom", packKey: "plugin:fractal-zoom" } };
const FLUID = { id: "fluid-dyn", meta: { packId: "fluid-dyn", packName: "Fluid", packKey: "plugin:fluid-dyn" } };

class FakeChromeGl {
  lost = false;
  restoreAllowed = false;
  /** Browser-side loss the browser will never give back (e.g. the page is blocked from 3D). */
  unrestorable = false;
  restoreCalls = 0;
  refusedRestores = 0;
  readonly ext = {
    loseContext: () => this.loseContext(),
    restoreContext: () => this.restoreContext(),
  };

  constructor(private readonly canvas: HTMLCanvasElement) {}

  isContextLost(): boolean { return this.lost; }
  fenceSync(): null { return null; }
  getContextAttributes(): { antialias: boolean } { return { antialias: false }; }
  getExtension(name: string): unknown {
    if (this.lost) return null;
    return name === "WEBGL_lose_context" ? this.ext : null;
  }
  getShaderInfoLog(): string { return this.lost ? "" : "compile error"; }
  getProgramInfoLog(): string { return ""; }

  private queueLostEvent(): void {
    setTimeout(() => {
      const e = new Event("webglcontextlost", { cancelable: true });
      this.canvas.dispatchEvent(e);
      this.restoreAllowed = e.defaultPrevented && !this.unrestorable;
    }, 0);
  }

  loseContext(): void {
    if (this.lost) return; // INVALID_OPERATION
    this.lost = true;
    this.queueLostEvent();
  }

  /** GPU reset / watchdog: lost now, event from a task; `autoRestoreMs` = the browser restores by itself. */
  browserLoss(opts: { autoRestoreMs?: number; restorable?: boolean } = {}): void {
    this.lost = true;
    this.unrestorable = opts.restorable === false;
    this.queueLostEvent();
    if (opts.autoRestoreMs !== undefined) setTimeout(() => this.finishRestore(), opts.autoRestoreMs);
  }

  restoreContext(): void {
    this.restoreCalls += 1;
    if (!this.lost || !this.restoreAllowed) {
      this.refusedRestores += 1; // "context restoration not allowed"
      return;
    }
    this.restoreAllowed = false;
    setTimeout(() => this.finishRestore(), 0);
  }

  /** The browser gives the context back (late restore after the host stopped trying). */
  finishRestore(): void {
    if (!this.lost) return;
    this.lost = false;
    this.unrestorable = false;
    this.canvas.dispatchEvent(new Event("webglcontextrestored"));
  }
}

type Harness = {
  host: RenderHost;
  wall: HTMLElement;
  pane: HTMLElement;
  scene: NetScene;
  gl: FakeChromeGl;
  render: ReturnType<typeof vi.fn>;
  compile: ReturnType<typeof vi.fn>;
  rafQueue: FrameRequestCallback[];
  frame: () => void;
  /** The light view that draws through `present` (runTimedViewDraw). */
  probe: HostedView;
};

function rect(w: number, h: number): () => DOMRect {
  return () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

/** Boot a solo wall on Backrooms over the shared host, with a Chrome-like GL context. */
function bootBackrooms(): Harness {
  const rafQueue: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { value: 640 });
  Object.defineProperty(wall, "clientHeight", { value: 480 });
  const pane = document.createElement("div");
  Object.defineProperty(pane, "clientWidth", { value: 640 });
  Object.defineProperty(pane, "clientHeight", { value: 480 });
  wall.appendChild(pane);
  document.body.appendChild(wall);
  const host = new RenderHost(wall);
  Object.defineProperty(host, "software", { value: false });
  const gl = new FakeChromeGl(host.canvas);
  const rd = host.renderer as unknown as THREE.WebGLRenderer;
  const render = vi.fn();
  const compile = vi.fn();
  Object.assign(rd, {
    getContext: () => gl,
    forceContextLoss: () => gl.ext.loseContext(),
    forceContextRestore: () => gl.ext.restoreContext(),
    render,
    compile,
  });
  host.canvas.getBoundingClientRect = rect(640, 480);
  pane.getBoundingClientRect = rect(640, 480);
  const scene = new NetScene(pane, { satellite: true, host, tileId: "main" });
  // Count what the host draws through a light view on the same pane (NetScene's own tick is not under test).
  host.remove(scene);
  const probe: HostedView = {
    viewEl: pane,
    hostFrame: () => { host.present(probe, 0x000000, new THREE.Scene(), new THREE.PerspectiveCamera()); },
    hostContextLost: () => scene.hostContextLost(),
    hostContextRestored: () => scene.hostContextRestored(),
  };
  host.add(probe);
  let ts = 0;
  const frame = () => { ts += 16; host.advanceFrame(ts); };
  expect(pick(scene, BACKROOMS)).toBeNull();
  expect(compile).toHaveBeenCalledTimes(1);
  return { host, wall, pane, scene, gl, render, compile, rafQueue, frame, probe };
}

/** The pack sky installed on the tile (the backdrop only reports it while its kind is "plugin"). */
function installedSky(scene: NetScene): string | null {
  return (scene as unknown as { backdrop: { pluginId: string | null } }).backdrop.pluginId;
}

function pick(scene: NetScene, view: typeof BACKROOMS): string | null {
  return scene.setPluginShader({ id: view.id, source: SKY }, view.meta);
}

function notices(wall: HTMLElement): HTMLElement[] {
  return [...wall.querySelectorAll<HTMLElement>(".gfx-wall-notice")];
}

/** Draws made by the host over `n` frames. */
function drawsOver(h: Harness, n: number): number {
  const before = h.render.mock.calls.length;
  for (let i = 0; i < n; i++) h.frame();
  return h.render.mock.calls.length - before;
}

/** A later pick lands on a live tile: compiled (not skipped, not dead), no fallback, and drawn. */
function expectPickLandsAndDraws(h: Harness, view: typeof BACKROOMS): void {
  const compiles = h.compile.mock.calls.length;
  expect(pick(h.scene, view)).toBeNull();
  expect(h.compile.mock.calls.length).toBe(compiles + 1);
  expect(h.host.tileShaderDead("main")).toBe(false);
  expect(h.pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
  expect(installedSky(h.scene)).toBe(view.id);
  expect(drawsOver(h, 5)).toBe(5);
}

function expectRecovered(h: Harness): void {
  // The wall notice clears on the first real frame drawn after the restore (UX Pro, row 4), so draw one.
  expect(drawsOver(h, 1)).toBe(1);
  expect(h.gl.lost).toBe(false);
  expect(h.host.glContextLost).toBe(false);
  expect(h.scene.gpuContextLost).toBe(false);
  expect(h.host.contextRecovery).toBe("ok");
  expect(notices(h.wall).length).toBe(0);
}

describe("#179 render host context recovery (Backrooms boot)", () => {
  let h: Harness | null = null;

  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  });

  afterEach(() => {
    h?.host.dispose();
    h?.wall.remove();
    h = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("heal-ladder recreate: a frame before the lost event does not strand the context; the host restores and later picks draw", () => {
    h = bootBackrooms();
    expect(drawsOver(h, 3)).toBe(3);
    // Tile health's "recreate-context" step on the black Backrooms tile (~45 s in UX Pro's run).
    h.host.recreateContext();
    // A frame is due before the queued lost-event task runs (Chrome may run rAF first).
    for (const cb of h.rafQueue.splice(0)) cb(performance.now());
    vi.advanceTimersByTime(0); // lost event
    expect(notices(h.wall).length).toBe(1);
    vi.advanceTimersByTime(50); // host restore + restored event
    expectRecovered(h);
    expect(h.gl.restoreCalls).toBeGreaterThanOrEqual(1);
    expectPickLandsAndDraws(h, FLUID);
  });

  it("lost with no browser restore: the host asks for the context back itself, then later picks land", () => {
    h = bootBackrooms();
    h.gl.browserLoss({ restorable: true }); // lost, restore allowed, but the browser never restores on its own
    vi.advanceTimersByTime(0);
    expect(h.host.glContextLost).toBe(true);
    expect(drawsOver(h, 30)).toBe(0);
    // A pick while lost still lands on the tile (never marks it dead, no "can't run" fallback).
    expect(pick(h.scene, FLUID)).toBeNull();
    expect(h.host.tileShaderDead("main")).toBe(false);
    expect(h.pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    vi.advanceTimersByTime(5_000);
    expectRecovered(h);
    expectPickLandsAndDraws(h, FRACTAL);
  });

  it("lost for good: the wall shows the single cant-draw notice with Reload (never a silent stop), and a late restore still recovers", () => {
    h = bootBackrooms();
    h.gl.browserLoss({ restorable: false });
    vi.advanceTimersByTime(0);
    expect(notices(h.wall).map((n) => n.textContent)).toEqual([GFX_INTERRUPTED_NOTICE]);
    vi.advanceTimersByTime(5_000);
    // Still inside the notice's 10 s "Restoring…" window: the host is trying, no early Reload.
    expect(h.gl.restoreCalls).toBeGreaterThanOrEqual(1);
    expect(h.wall.querySelectorAll(".gfx-wall-reload").length).toBe(0);
    expect(h.host.contextRecovery).toBe("restoring");
    vi.advanceTimersByTime(5_500);
    expect(h.gl.restoreCalls).toBeGreaterThanOrEqual(1);
    expect(h.host.contextRecovery).toBe("gave-up");
    const n = notices(h.wall);
    expect(n.length).toBe(1);
    expect(n[0]!.textContent).toContain(GFX_NO_RESTORE_NOTICE);
    expect(n[0]!.querySelectorAll(".gfx-wall-reload").length).toBe(1);
    // The picker keeps working while the wall can't draw.
    expect(pick(h.scene, FLUID)).toBeNull();
    expect(installedSky(h.scene)).toBe("fluid-dyn");
    expect(h.host.tileShaderDead("main")).toBe(false);
    // The browser gives it back later: the notice clears and the next pick draws.
    h.gl.finishRestore();
    expectRecovered(h);
    expectPickLandsAndDraws(h, FRACTAL);
  });

  it("lost then restored with a second loss mid-rebuild: the tile is not left dead behind the fallback", () => {
    h = bootBackrooms();
    h.gl.browserLoss({ autoRestoreMs: 1_500 });
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(1_500); // browser restores
    expect(h.host.glContextLost).toBe(false);
    // The restore rebuild recompiles; the context dies again inside that compile (empty logs).
    const rd = h.host.renderer as unknown as THREE.WebGLRenderer;
    h.compile.mockImplementationOnce(() => {
      h!.gl.browserLoss({ restorable: true });
      rd.debug!.onShaderError!(h!.gl as unknown as WebGL2RenderingContext, {} as never, {} as never, {} as never);
    });
    expect(h.host.probeTileSky("main", new THREE.Scene(), new THREE.PerspectiveCamera())).toBeNull();
    expect(h.host.tileShaderDead("main")).toBe(false);
    expect(h.pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    vi.advanceTimersByTime(5_000);
    expectRecovered(h);
    expect(h.pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    expectPickLandsAndDraws(h, FRACTAL);
  });

  it("row 4 (Fractal zoom): restored, then lost again with no browser restore -- the host recovers again instead of stopping", () => {
    h = bootBackrooms();
    expectPickLandsAndDraws(h, FRACTAL);
    // First loss (frame 17 in PA's trace) comes back on its own (frame 20)...
    h.gl.browserLoss({ autoRestoreMs: 48 });
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(48);
    expect(h.host.glContextLost).toBe(false);
    expect(drawsOver(h, 2)).toBe(2);
    // ...then it is lost again right after the restore (frame 22) and the browser never restores it.
    h.gl.browserLoss({ restorable: true });
    vi.advanceTimersByTime(0);
    expect(drawsOver(h, 10)).toBe(0);
    vi.advanceTimersByTime(5_000);
    expectRecovered(h);
    expect(notices(h.wall).length).toBe(0);
    expectPickLandsAndDraws(h, FLUID);
    // And a third loss/restore cycle is handled the same way (recovery is not one-shot).
    h.host.recreateContext();
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(50);
    expectRecovered(h);
    expectPickLandsAndDraws(h, BACKROOMS);
  });

  it("row 4 (UX Pro): restored but no frame draws after it -- the notice stays up and switches to Reload at 10 s", () => {
    h = bootBackrooms();
    h.gl.browserLoss({ autoRestoreMs: 1_500 });
    vi.advanceTimersByTime(0); // lost at t=0
    expect(notices(h.wall).map((n) => n.textContent)).toEqual([GFX_INTERRUPTED_NOTICE]);
    vi.advanceTimersByTime(1_500); // webglcontextrestored at 1.5 s, and no frame is drawn after it
    expect(h.gl.lost).toBe(false);
    expect(h.host.glContextLost).toBe(false);
    expect(h.render).not.toHaveBeenCalled();
    expect(notices(h.wall).map((n) => n.textContent), "restored event alone must not clear the notice").toEqual([GFX_INTERRUPTED_NOTICE]);
    vi.advanceTimersByTime(8_499); // t = 9.999 s
    expect(notices(h.wall).map((n) => n.textContent)).toEqual([GFX_INTERRUPTED_NOTICE]);
    expect(h.wall.querySelectorAll(".gfx-wall-reload").length).toBe(0);
    vi.advanceTimersByTime(1); // t = 10 s
    const n = notices(h.wall);
    expect(n.length).toBe(1);
    expect(n[0]!.textContent).toBe(`${GFX_NO_RESTORE_NOTICE}Reload`);
    // Positive half: the first real frame drawn after the restore clears it.
    expect(drawsOver(h, 1)).toBe(1);
    expect(notices(h.wall).length).toBe(0);
    expectPickLandsAndDraws(h, FRACTAL);
  });

  it("row 4 (UX Pro), positive: a restore followed by a real drawn frame clears the notice before the 10 s mark", () => {
    h = bootBackrooms();
    h.gl.browserLoss({ autoRestoreMs: 1_500 });
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(1_500);
    expect(notices(h.wall).length).toBe(1);
    vi.advanceTimersByTime(500);
    expect(drawsOver(h, 1)).toBe(1);
    expect(notices(h.wall).length).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(notices(h.wall).length).toBe(0);
    expect(h.wall.querySelectorAll(".gfx-wall-reload").length).toBe(0);
  });

  it("dispose while lost: the host's notice and timer go with it; a new host shows exactly one notice", () => {
    h = bootBackrooms();
    h.gl.browserLoss({ restorable: false });
    vi.advanceTimersByTime(0);
    expect(notices(h.wall).length).toBe(1);
    const wall = h.wall;
    h.host.dispose();
    expect(notices(wall).length).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(notices(wall).length).toBe(0);
    expect(wall.querySelectorAll(".gfx-wall-reload").length).toBe(0);
    const next = new RenderHost(wall);
    next.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(notices(wall).length).toBe(1);
    next.dispose();
    wall.remove();
    h = null;
  });

  // ---- #179 QE replay: rows for reverts that turned nothing red at b7560ada ----

  it("replay a (offerReload): when the host's last restore attempt fails it tells the notice to offer Reload, once, at the give-up", () => {
    h = bootBackrooms();
    const offerReload = vi.spyOn(h.host.gfxWallNotice, "offerReload");
    h.gl.browserLoss({ restorable: false });
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(9_999);
    expect(h.host.contextRecovery).toBe("restoring");
    expect(offerReload).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(h.host.contextRecovery).toBe("gave-up");
    expect(offerReload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(offerReload).toHaveBeenCalledTimes(1);
  });

  it("replay b (attempts reset on loss): a second lost event before any restore gets the full attempt ladder again, not the leftovers", () => {
    h = bootBackrooms();
    h.gl.browserLoss({ restorable: false });
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(4_500); // attempts at 1 s and 4 s, no restored event
    expect(h.gl.restoreCalls).toBe(2);
    // The GPU process is lost again before anything came back: a fresh loss event on the same canvas.
    h.host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const calls = h.gl.restoreCalls;
    vi.advanceTimersByTime(9_999);
    expect(h.gl.restoreCalls - calls, "a full ladder: one attempt per CONTEXT_RESTORE_RETRY_MS step").toBe(3);
    expect(h.host.contextRecovery).toBe("restoring");
    vi.advanceTimersByTime(1);
    expect(h.host.contextRecovery).toBe("gave-up");
  });

  it("replay c (dispose clears the restore timer): dispose while restoring leaves no host timer behind", () => {
    h = bootBackrooms();
    vi.advanceTimersByTime(0);
    const idle = vi.getTimerCount();
    h.gl.browserLoss({ restorable: false });
    vi.advanceTimersByTime(0);
    expect(h.host.contextRecovery).toBe("restoring");
    expect(vi.getTimerCount(), "the notice window and the host's restore timer").toBe(idle + 2);
    h.host.dispose();
    expect(vi.getTimerCount()).toBe(idle);
    h.wall.remove();
    h = null;
  });

  it("replay d (drawn-frame flag, sandbox-bitmap path): after a restore, a frame drawn only by a sandbox bitmap mirror clears the notice", () => {
    h = bootBackrooms();
    const pluginId = "plugin:replay-bitmap";
    // The host gets its per-pack bitmap GPU from sandboxBitmapGl(); stub the class so no real GL runs.
    vi.spyOn(SandboxBitmapGl.prototype, "uploadFrame").mockReturnValue(new THREE.Texture());
    const present = vi.spyOn(SandboxBitmapGl.prototype, "present").mockImplementation((_rd, _tex, _fill, dst) => dst);
    const bitmap = (): ImageBitmap => {
      const bmp = Object.create(ImageBitmap.prototype) as ImageBitmap;
      Object.defineProperties(bmp, { width: { value: 64 }, height: { value: 64 }, close: { value: () => {} } });
      return bmp;
    };
    const fill = surfaceLetterboxFill(0x000000, 0);
    const view: HostedView = {
      viewEl: h.pane,
      hostFrame: () => { h!.host.presentBitmapMirror(view, bitmap(), fill, 1, pluginId); },
      hostContextLost: () => {},
      hostContextRestored: () => {},
    };
    h.host.remove(h.probe);
    h.host.add(view);
    h.gl.browserLoss({ autoRestoreMs: 1_500 });
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(1_500);
    expect(h.host.glContextLost).toBe(false);
    expect(notices(h.wall).length).toBe(1);
    h.frame();
    expect(present).toHaveBeenCalledTimes(1);
    expect(h.render).not.toHaveBeenCalled();
    expect(notices(h.wall).length).toBe(0);
  });

  it("replay e (drawn-frame flag, pack-primary path): after a restore, a frame drawn only by a pack-mirror primary clears the notice", () => {
    h = bootBackrooms();
    const renderPrimary = vi.spyOn(h.host.packMirrors, "renderPrimary").mockImplementation(() => undefined as never);
    vi.spyOn(h.host.packMirrors, "presentPack").mockImplementation(() => null as never);
    const view = {
      viewEl: h.pane,
      packCoalesceGroupKey: "plugin:replay-pack",
      packCoalesceTileCount: 2,
      isPackMirrorPrimary: true,
      hostFrame: () => { h!.host.present(view, 0x000000, new THREE.Scene(), new THREE.PerspectiveCamera()); },
      hostContextLost: () => {},
      hostContextRestored: () => {},
    };
    h.host.remove(h.probe);
    h.host.add(view);
    h.gl.browserLoss({ autoRestoreMs: 1_500 });
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(1_500);
    expect(h.host.glContextLost).toBe(false);
    expect(notices(h.wall).length).toBe(1);
    h.frame();
    expect(renderPrimary).toHaveBeenCalledTimes(1);
    expect(h.render).not.toHaveBeenCalled();
    expect(notices(h.wall).length).toBe(0);
  });

  it("replay f (recreateContext while lost): after the host gave up, a heal-ladder recreate asks for the context back again and recovers", () => {
    h = bootBackrooms();
    h.gl.browserLoss({ restorable: false });
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(10_500);
    expect(h.host.contextRecovery).toBe("gave-up");
    const calls = h.gl.restoreCalls;
    // The browser would now honour a restore; nothing arrives on its own.
    h.gl.unrestorable = false;
    h.gl.restoreAllowed = true;
    h.host.recreateContext();
    vi.advanceTimersByTime(50); // host restore + restored event
    expect(h.gl.restoreCalls).toBe(calls + 1);
    expectRecovered(h);
    expectPickLandsAndDraws(h, FLUID);
  });

  it("software host: a context loss never schedules a restore; the notice's 10 s window is the only timer it adds", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true });
    expect(host.software).toBe(true);
    const before = vi.getTimerCount();
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(notices(wall).length).toBe(1);
    expect(vi.getTimerCount()).toBe(before + 1);
    host.dispose();
    expect(vi.getTimerCount()).toBe(before);
    wall.remove();
  });

  it("software host (UX Pro): after a loss the notice's own 10 s window still offers Reload -- never stuck on Restoring with nothing to press", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true });
    expect(host.software).toBe(true);
    const restoreTimer = () => (host as unknown as { restoreTimer: ReturnType<typeof setTimeout> | null }).restoreTimer;
    const before = vi.getTimerCount();
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    // No restore timer on a software host: the notice's window is the only way out.
    expect(restoreTimer(), "host restore timer on a software host").toBeNull();
    expect(vi.getTimerCount(), "timers the loss added (the notice window only)").toBe(before + 1);
    expect(notices(wall).map((n) => n.textContent)).toEqual([GFX_INTERRUPTED_NOTICE]);
    vi.advanceTimersByTime(9_999);
    expect(notices(wall).map((n) => n.textContent), "at 9.999 s: still Restoring").toEqual([GFX_INTERRUPTED_NOTICE]);
    expect(wall.querySelectorAll(".gfx-wall-reload").length, "no Reload before 10 s").toBe(0);
    vi.advanceTimersByTime(1);
    const n = notices(wall);
    expect(n.length, "one notice at 10 s").toBe(1);
    expect(n[0]!.textContent, "at 10 s: the cant-draw copy with Reload").toBe(`${GFX_NO_RESTORE_NOTICE}Reload`);
    expect(n[0]!.querySelectorAll(".gfx-wall-reload").length, "one Reload button to press").toBe(1);
    expect(restoreTimer(), "still no host restore timer").toBeNull();
    expect(vi.getTimerCount(), "nothing left pending after the window (no restore retries)").toBe(before);
    vi.advanceTimersByTime(20_000);
    expect(notices(wall).map((x) => x.textContent), "Reload stays up").toEqual([`${GFX_NO_RESTORE_NOTICE}Reload`]);
    host.dispose();
    wall.remove();
  });

  it("GL host whose renderer has no forceContextRestore: a context loss never schedules a restore either", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    Object.defineProperty(host, "software", { value: false });
    expect(typeof (host.renderer as Partial<THREE.WebGLRenderer>).forceContextRestore).toBe("undefined");
    const before = vi.getTimerCount();
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(notices(wall).length).toBe(1);
    expect(vi.getTimerCount()).toBe(before + 1);
    host.dispose();
    wall.remove();
  });
});
