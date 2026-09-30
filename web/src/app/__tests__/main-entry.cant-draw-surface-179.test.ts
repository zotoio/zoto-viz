/** @vitest-environment happy-dom */
/**
 * #179 part (c), UX Pro: what a solo wall shows when one pack's shader fails, through the production entry
 * (main.ts). The saved boot mode is the pack; main.ts installs its sky with its pack (installPluginSky ->
 * installTileSkyShader -> NetScene.setPluginShader with PackSkyMeta, TSE b429dc16), the shared host probes the
 * compile, and the fake GL context fails it through three's `renderer.debug.onShaderError` hook, so the host's
 * tile-shader latch catches it as it would in Chrome. Nothing here calls the host directly.
 * Only production modules that exist on main are imported: these rows fail on main by assertion, not by import.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootMainEntry, pickModeFromUi, setHarnessFetchOverride } from "./main-entry-harness";

type FakeGlLike = { isContextLost(): boolean; getShaderInfoLog(s: object): string; getProgramInfoLog(p: object): string };
/** The wall's RenderHost (the rows only read that it is the GL host). */
type WallHost = { canvas: HTMLCanvasElement };
type FakeDebug = { checkShaderErrors: boolean; onShaderError: ((gl: FakeGlLike, program: object, vs: object, fs: object) => void) | null };

const t = vi.hoisted(() => {
  class FakeGl {
    lost = false;
    constructor(readonly canvas: HTMLCanvasElement) {
      // Every GL call these rows don't care about is a no-op that hands back null.
      return new Proxy(this, {
        get: (target, key, recv) => (key in target ? Reflect.get(target, key, recv) : () => null),
      });
    }
    isContextLost(): boolean { return this.lost; }
    fenceSync(): null { return null; }
    getContextAttributes(): { antialias: boolean } { return { antialias: false }; }
    getExtension(): null { return null; }
    getShaderInfoLog(): string { return ""; }
    getProgramInfoLog(): string { return ""; }
  }
  const state: {
    FakeGl: typeof FakeGl;
    host: WallHost | null;
    /** The info log the wall's sky compiles fail with while set; null = they compile. */
    failLog: string | null;
  } = { FakeGl, host: null, failLog: null };
  return state;
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
      const debug: FakeDebug = { checkShaderErrors: false, onShaderError: null };
      Object.assign(this.renderer, {
        getContext: () => gl,
        forceContextLoss: () => {},
        forceContextRestore: () => {},
        render: () => {},
        debug,
        // three calls debug.onShaderError from compile() when a program fails: the latch hooks it for the probe.
        compile: () => {
          const log = t.failLog;
          if (log === null) return;
          debug.onShaderError?.({ isContextLost: () => false, getShaderInfoLog: () => log, getProgramInfoLog: () => "" }, {}, {}, {});
        },
      });
      t.host = this;
    }
  }
  return { ...real, RenderHost: WallGlHost };
});

function skyPack(id: string, name: string) {
  return {
    id, name, version: 1, engine: "graph", base: "topology",
    look: { backdrop: "plugin" },
    has_frontend: false, frontend: { entry: "frontend/index.ts" }, capabilities: [],
    has_sky: true, has_sky_shader: true, has_backend: false, has_datasource: false,
    consent: "reviewed",
  };
}
const SKY = "void main() { fragColor = vec4(normalize(vDir), 1.0); }";
const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } }));

const FAIL_LOG = "ERROR: 0:12: 'uFoo' : undeclared identifier";

/**
 * Boot main.ts on `plugin:<id>` (the saved profile mode) with `packs` installed. When `failing`, every sky compile
 * fails (FAIL_LOG) until the row clears `t.failLog`: the boot's own sky install is the shader failure.
 */
async function bootOn(id: string, packs: Array<[string, string]>, failing: boolean): Promise<void> {
  setHarnessFetchOverride((p, method) => {
    if (p === "/api/plugins") return json({ dir: "", schema: "", plugins: packs.map(([pid, name]) => skyPack(pid, name)), errors: [] });
    if (p === "/api/profiles/user" && method === "GET") return json({ settings: { mode: `plugin:${id}` } });
    if (/^\/api\/plugins\/[^/]+\/sky\/fragment\.glsl$/.test(p)) return Promise.resolve(new Response(SKY, { status: 200 }));
    return null;
  });
  localStorage.clear();
  sessionStorage.clear();
  t.failLog = failing ? FAIL_LOG : null;
  await bootMainEntry();
  await vi.waitFor(() => expect(localStorage.getItem("zoto-viz.mode")).toBe(`plugin:${id}`), { timeout: 8000 });
  expect(t.host?.canvas.hasAttribute("data-softgl"), "the wall draws through a GL host").toBe(false);
  // The page's own stylesheet (the harness drops the <link>): the rows read computed visibility from it.
  const css = document.createElement("style");
  css.textContent = readFileSync(resolve(import.meta.dirname, "../../style.css"), "utf8");
  document.head.appendChild(css);
}

const tile = () => document.getElementById("scene")!;

/** main.ts's sky install failed on the GPU and the tile says so (waits for the async install and switch). */
async function waitCouldntDraw(sentence: string): Promise<void> {
  await vi.waitFor(() => expect(tile().textContent ?? "").toContain(sentence), { timeout: 8000 });
  // Settled: nothing after the failure (the switch's error handling, the sky wait) writes over it.
  await new Promise((r) => setTimeout(r, 300));
}

/** A floating graph label on the tile, where NetScene's LabelLayer puts them (inside the tile's container). */
function graphLabel(): HTMLElement {
  const layer = document.createElement("div");
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = "192.168.1.1";
  layer.appendChild(label);
  tile().appendChild(layer);
  return label;
}

/**
 * The label's visibility as the page's CSS gives it now. happy-dom caches an element's computed style and does
 * not drop it when an ancestor's attribute changes (a browser does), so this reads a fresh copy in the same spot.
 */
function labelVisibility(label: HTMLElement): string {
  const probe = label.cloneNode(true);
  label.after(probe);
  const vis = probe instanceof Element ? getComputedStyle(probe).visibility : "";
  probe.parentNode?.removeChild(probe);
  return vis;
}

describe("#179 part (c) UX Pro: a solo wall whose pack shader fails (production entry)", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    setHarnessFetchOverride(null);
    t.failLog = null;
    // Let the booted main.ts's debounced session write land, then wipe it (as the #179 app rows do).
    await new Promise((r) => setTimeout(r, 200));
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("copy: a shader failure the tile-shader latch caught says 'couldn't draw' (viewStateCopy), never 'can't run its graphics on this device'", { timeout: 30_000 }, async () => {
    await bootOn("fluid-dyn", [["fluid-dyn", "Fluid Dynamics"]], true);
    await waitCouldntDraw("Fluid Dynamics couldn't draw. Pick another view, or reload to try again.");
    expect(tile().querySelectorAll(".tile-shader-fallback").length, "the host's latch caught it (its fallback is up)").toBe(1);
    const text = tile().textContent ?? "";
    expect(text, "capability copy is not a shader failure").not.toMatch(/can't run its graphics|on this device/);
    expect(text, "solo wall: no 'other tiles'").not.toMatch(/other tiles/i);
    expect(text, "apply-mode keeps cant-draw: no generic couldn't-start over it").not.toMatch(/couldn't start/);
  });

  it("labels: the tile's graph labels are hidden while the couldn't-draw line shows, and come back when it clears", { timeout: 45_000 }, async () => {
    const packs: Array<[string, string]> = [["calm-sky", "Calm Sky"], ["fluid-dyn", "Fluid Dynamics"]];
    await bootOn("calm-sky", packs, false);
    const label = graphLabel();
    expect(labelVisibility(label), "before the failure").not.toBe("hidden");
    // Pick the pack whose sky fails: main.ts installs it, the host's probe fails the compile.
    t.failLog = FAIL_LOG;
    await pickModeFromUi("plugin:fluid-dyn");
    await waitCouldntDraw("Fluid Dynamics couldn't draw.");
    expect(labelVisibility(label), "while the line shows").toBe("hidden");
    // Back to the pack whose sky compiled: the tile leaves cant-draw / shader, and its labels come back.
    // (main.ts does not reinstall that sky -- its failed install left skyLoaded on it -- so the host's fallback
    // element stays mounted; reported to TSE. This row is about the labels.)
    const vs = await import("../view-state");
    t.failLog = null;
    await pickModeFromUi("plugin:calm-sky");
    await vi.waitFor(() => expect(vs.viewStateOf("main")?.kind).toBe("ready"), { timeout: 8000 });
    expect(labelVisibility(label), "after it clears").not.toBe("hidden");
  });

  it("name: a pack name with markup reaches the tile in literal, sanitized text (no element), and an empty name is 'This view'", { timeout: 60_000 }, async () => {
    const raw = "<img src=x onerror=alert(1)>";
    await bootOn("xss-pack", [["xss-pack", raw]], true);
    await waitCouldntDraw("couldn't draw");
    expect(tile().querySelectorAll("img").length, "no element injected from the pack name").toBe(0);
    expect(tile().textContent ?? "").toContain("img src=x onerror=alert(1) couldn't draw. Pick another view, or reload to try again.");
    await new Promise((r) => setTimeout(r, 200));
    // A name that sanitizes to nothing (the catalog won't take an empty one): viewStateCopy says "This view".
    await bootOn("nameless", [["nameless", "<>"]], true);
    await waitCouldntDraw("couldn't draw");
    expect(tile().textContent ?? "").toContain("This view couldn't draw. Pick another view, or reload to try again.");
  });
});
