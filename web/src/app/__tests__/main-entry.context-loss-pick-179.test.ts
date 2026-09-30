/** @vitest-environment happy-dom */
/**
 * #179 app level: Backrooms as the saved boot mode, a lost WebGL context, then a pick of another stage-only view.
 * Through the production entry (main.ts): the saved mode comes back through the profile path (/api/profiles/user
 * -> ProfileStore.boot -> applySettings -> applyMode), and the pick goes through the header picker -> applyMode ->
 * applyModeImpl. The shared RenderHost is a GL host over a fake context that follows Chrome's rules closely enough
 * for these rows: the lost / restored events come from the canvas, `isContextLost()` agrees with them, and the
 * browser never gives the context back unless the row says so. Frames are driven by hand (rAF is stubbed).
 * Observable: the header picker's label, the saved `zoto-viz.mode`, every result the mode switch settles with
 * (settleConsentAndDrainAuto), the host's lost flag, the wall notice, and the sky drawn on the main tile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootMainEntry, pickModeFromUi, setHarnessFetchOverride } from "./main-entry-harness";

const t = vi.hoisted(() => {
  class FakeGl {
    lost = false;
    restoreCalls = 0;
    constructor(readonly canvas: HTMLCanvasElement) {
      // Every GL call these rows don't care about (buffers, reads, syncs) is a no-op that hands back null.
      return new Proxy(this, {
        get: (target, key, recv) => (key in target ? Reflect.get(target, key, recv) : () => null),
      });
    }
    isContextLost(): boolean { return this.lost; }
    fenceSync(): null { return null; }
    getContextAttributes(): { antialias: boolean } { return { antialias: false }; }
    getExtension(): null { return null; }
    getShaderInfoLog(): string { return this.lost ? "" : "compile error"; }
    getProgramInfoLog(): string { return ""; }
    /** Chrome refuses a page restore here: only the row's own `restore()` brings the context back. */
    restoreContext(): void { this.restoreCalls += 1; }
  }
  return {
    FakeGl,
    host: null as null | { canvas: HTMLCanvasElement; glContextLost: boolean; advanceFrame(ts: number): void; renderer: unknown },
    gl: null as null | InstanceType<typeof FakeGl>,
    settled: [] as string[],
  };
});

vi.mock("../mode-switch-coordinator", async (orig) => {
  const real = await orig<typeof import("../mode-switch-coordinator")>();
  return {
    ...real,
    settleConsentAndDrainAuto: (result: Parameters<typeof real.settleConsentAndDrainAuto>[0], declined?: string | null) => {
      t.settled.push(result);
      real.settleConsentAndDrainAuto(result, declined);
    },
  };
});

vi.mock("../../graph/render-host", async (orig) => {
  const real = await orig<typeof import("../../graph/render-host")>();
  class WallGlHost extends real.RenderHost {
    constructor(...args: ConstructorParameters<typeof real.RenderHost>) {
      super(...args);
      if (args[0].id !== "wall") return;
      Object.defineProperty(this, "software", { value: false });
      delete this.canvas.dataset.softgl;
      const gl = new t.FakeGl(this.canvas);
      Object.assign(this.renderer, {
        getContext: () => gl,
        forceContextLoss: () => {},
        forceContextRestore: () => gl.restoreContext(),
        render: () => {},
        compile: () => {},
      });
      t.host = this;
      t.gl = gl;
    }
  }
  return { ...real, RenderHost: WallGlHost };
});

const SKY = "void main() { fragColor = vec4(normalize(vDir), 1.0); }";
const BACKROOMS = "plugin:backrooms";
const FLUID = "plugin:fluid-dyn";

function skyPack(id: string, name: string) {
  return {
    id, name, version: 1, engine: "graph", base: "topology",
    look: { backdrop: "plugin", stageOnly: true },
    has_frontend: false, frontend: { entry: "frontend/index.ts" }, capabilities: [],
    has_sky: true, has_sky_shader: true, has_backend: false, has_datasource: false,
    consent: "reviewed",
  };
}
const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } }));

/** Sky requests the row holds until it lets them go (a switch caught in the middle). */
let holdSky: Set<string> = new Set();
let held: { id: string; release: () => void }[] = [];

function serve(): void {
  setHarnessFetchOverride((p, method) => {
    if (p === "/api/plugins") {
      return json({ dir: "", schema: "", plugins: [skyPack("backrooms", "NET Backrooms"), skyPack("fluid-dyn", "Fluid Dynamics")], errors: [] });
    }
    // The saved boot mode: the startup profile ("user") saved plugin:backrooms, as UX Pro's step 1 left it.
    if (p === "/api/profiles/user" && method === "GET") return json({ settings: { mode: BACKROOMS } });
    const sky = /^\/api\/plugins\/([^/]+)\/sky\/fragment\.glsl$/.exec(p);
    if (sky) {
      const id = decodeURIComponent(sky[1]!);
      if (holdSky.has(id)) {
        return new Promise<Response>((res) => held.push({ id, release: () => res(new Response(SKY, { status: 200 })) }));
      }
      return Promise.resolve(new Response(SKY, { status: 200 }));
    }
    return null;
  });
}

const headerLabel = () => document.querySelector("#mode button.field-btn")?.textContent ?? "";
const notices = () => document.querySelectorAll(".gfx-wall-notice").length;
type SceneLike = { pluginSkyDrawn: string | null; gpuContextLost: boolean };
const mainScene = (): SceneLike => (t.host as unknown as { views: SceneLike[] }).views[0]!;
let ts = 0;
/** The harness drops rAF callbacks; after boot the rows queue them and run them after each hand-driven frame. */
let rafQueue: FrameRequestCallback[] = [];
const frame = () => {
  ts += 16;
  t.host!.advanceFrame(ts);
  for (const cb of rafQueue.splice(0)) cb(ts);
};

function loseContext(): void {
  t.gl!.lost = true;
  t.host!.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
}
function restoreContext(): void {
  t.gl!.lost = false;
  t.host!.canvas.dispatchEvent(new Event("webglcontextrestored"));
}

const RECT = () => ({ left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

/** happy-dom lays nothing out: give the wall, the main tile and the host canvas a 640x480 box so frames draw. */
function layOutWall(): void {
  for (const el of [document.getElementById("wall"), document.getElementById("scene"), t.host!.canvas]) {
    if (!el) continue;
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 640 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 480 });
    el.getBoundingClientRect = RECT;
  }
}

async function bootOnBackrooms(): Promise<void> {
  serve();
  localStorage.clear();
  sessionStorage.clear();
  await bootMainEntry();
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", ((cb: FrameRequestCallback) => rafQueue.push(cb)) as typeof requestAnimationFrame);
  layOutWall();
  await vi.waitFor(() => {
    expect(localStorage.getItem("zoto-viz.mode")).toBe(BACKROOMS);
    expect(headerLabel()).toContain("NET Backrooms");
  }, { timeout: 8000 });
  expect(t.host?.canvas.hasAttribute("data-softgl"), "the wall draws through a GL host").toBe(false);
  // The boot switches settle first: nothing after this belongs to them.
  await vi.waitFor(() => expect(t.settled.length).toBeGreaterThan(0), { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 0));
}

/** Pick from the header and wait for that switch to settle; returns what it settled with. */
async function pick(id: string, beforeSettle?: () => Promise<void> | void): Promise<string[]> {
  t.settled.length = 0;
  await pickModeFromUi(id);
  if (beforeSettle) await beforeSettle();
  await vi.waitFor(() => expect(t.settled.length, `the switch to ${id} settled`).toBeGreaterThan(0), { timeout: 5000 });
  return [...t.settled];
}

function expectLanded(results: string[], id: string, label: string): void {
  expect(results, `switch results for ${id}`).toContain("ok");
  expect(results.filter((r) => r === "aborted" || r === "declined" || r === "failed"), `no aborted / declined / failed for ${id}`).toEqual([]);
  expect(localStorage.getItem("zoto-viz.mode"), "saved mode").toBe(id);
  expect(headerLabel(), "header").toContain(label);
}

describe("#179 app level: Backrooms saved as the boot mode, context lost, then a pick", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    sessionStorage.clear();
    t.settled.length = 0;
    holdSky = new Set();
    held = [];
    ts = 0;
  });

  afterEach(async () => {
    setHarnessFetchOverride(null);
    held.forEach((h) => h.release());
    held = [];
    // The harness can't unload the previous main.ts: let its debounced session write (80 ms) land, then wipe it so
    // the next row boots from the saved profile alone, as a fresh tab would.
    await new Promise((r) => setTimeout(r, 200));
    localStorage.clear();
    sessionStorage.clear();
  });

  it("lost with no restore: a pick of Fluid Dynamics lands -- the header ends on it and the switch settles ok (never aborted or declined)", { timeout: 30_000 }, async () => {
    await bootOnBackrooms();
    loseContext();
    expect(t.host!.glContextLost).toBe(true);
    expect(mainScene().gpuContextLost).toBe(true);
    expect(notices(), "the wall notice while lost").toBe(1);
    const results = await pick(FLUID);
    expectLanded(results, FLUID, "Fluid Dynamics");
    // Still lost (the browser never gave it back): the notice stays, nothing claims it drew.
    expect(t.host!.glContextLost).toBe(true);
    expect(notices()).toBe(1);
  });

  it("lost, then restored in the middle of the switch: the pick completes, the header ends on it, the sky draws and the notice clears", { timeout: 30_000 }, async () => {
    await bootOnBackrooms();
    loseContext();
    holdSky = new Set(["fluid-dyn"]);
    const results = await pick(FLUID, async () => {
      // The switch is waiting on the Fluid Dynamics sky: the context comes back now.
      await vi.waitFor(() => expect(held.map((h) => h.id)).toContain("fluid-dyn"), { timeout: 5000 });
      restoreContext();
      expect(t.host!.glContextLost).toBe(false);
      held.forEach((h) => h.release());
      held = [];
    });
    expectLanded(results, FLUID, "Fluid Dynamics");
    expect(notices(), "the notice holds until a frame is drawn after the restore (#179 row 4)").toBe(1);
    frame();
    expect(mainScene().pluginSkyDrawn, "the picked view's sky drew after the restore").toBe("fluid-dyn");
    expect(notices(), "the notice clears on the first drawn frame after the restore").toBe(0);
  });

  it("repeat: restored, lost again with no restore -- the next pick still lands", { timeout: 30_000 }, async () => {
    await bootOnBackrooms();
    loseContext();
    restoreContext();
    expect(t.host!.glContextLost).toBe(false);
    expect(mainScene().gpuContextLost, "the main tile hears the restore").toBe(false);
    expect(notices(), "the notice holds until a frame is drawn after the restore (#179 row 4)").toBe(1);
    frame();
    expect(notices()).toBe(0);
    expectLanded(await pick(FLUID), FLUID, "Fluid Dynamics");
    frame();
    loseContext();
    expect(t.host!.glContextLost).toBe(true);
    expectLanded(await pick(BACKROOMS), BACKROOMS, "NET Backrooms");
  });

  /**
   * #171 (c) landed on tse/issue-171c: app/view-state.ts has the per-tile `{ kind: "cant-draw", reason: "context-lost" }`
   * view state, written from the host's draw events by app/cant-draw-state.ts. This row uses, from
   * web/src/app/view-state.ts:
   *   - `viewStateOf(tileId: string): ViewState | null`
   *   - a `ViewState` member `{ kind: "cant-draw"; reason: "context-lost" }` (the reason is part of the union)
   * and tile ids from each drawn view's `Scene.tileId` on the shared host.
   */
  it("pending #171 (c): every tile enters cant-draw / context-lost on a loss and leaves it on restore plus a drawn frame", { timeout: 30_000 }, async () => {
    await bootOnBackrooms();
    // Imported after the boot: bootMainEntry resets modules, so only now is this the view-state main.ts writes to.
    const viewStateModule = `../${"view-state"}.ts`;
    const vs = (await import(/* @vite-ignore */ viewStateModule)) as {
      viewStateOf(tileId: string): { kind: string; reason?: string } | null;
    };
    frame();
    const tileIds = (t.host as unknown as { views: { tileId: string }[] }).views.map((v) => v.tileId);
    expect(tileIds.length, "tiles on the shared host").toBeGreaterThan(0);
    for (const id of tileIds) expect(vs.viewStateOf(id)?.kind, `tile ${id} before the loss`).not.toBe("cant-draw");

    loseContext();
    for (const id of tileIds) {
      expect(vs.viewStateOf(id), `tile ${id} while lost`).toEqual({ kind: "cant-draw", reason: "context-lost" });
    }
    // Still lost after a frame: the state holds.
    frame();
    for (const id of tileIds) {
      expect(vs.viewStateOf(id), `tile ${id} still lost`).toEqual({ kind: "cant-draw", reason: "context-lost" });
    }

    // Restore, then one drawn frame: the tile leaves cant-draw.
    restoreContext();
    frame();
    for (const id of tileIds) {
      expect(vs.viewStateOf(id)?.kind, `tile ${id} after restore + drawn frame`).not.toBe("cant-draw");
      expect(vs.viewStateOf(id)?.kind, `tile ${id} after restore + drawn frame`).toBe("ready");
    }
    expect(notices(), "the notice clears with the state").toBe(0);
  });
});
