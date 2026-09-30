/** @vitest-environment happy-dom */
/**
 * #179 part (c), UX Pro: what a solo wall shows when one pack's shader fails, through the production entry
 * (main.ts). The shared RenderHost is a GL host over a fake context; the pack's sky compile fails through three's
 * `renderer.debug.onShaderError` hook, so the host's tile-shader latch catches it as it would in Chrome.
 * The rows call the host the way NetScene.setPluginShader does with its pack meta (beginTilePack, then
 * probeTileSky); main.ts's own sky install does not pass that meta yet (TSE's open item), so the rows make it.
 * Only production modules that exist on main are imported: these rows fail on main by assertion, not by import.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootMainEntry, setHarnessFetchOverride } from "./main-entry-harness";

type FakeGlLike = { isContextLost(): boolean; getShaderInfoLog(s: object): string; getProgramInfoLog(p: object): string };
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
  return {
    FakeGl,
    host: null as null | {
      canvas: HTMLCanvasElement;
      beginTilePack(tileId: string, packKey: string, packId: string, mount: HTMLElement, packName: string, isShaderPack?: boolean): void;
      probeTileSky(tileId: string, scene: THREE.Scene, camera: THREE.Camera): string | null;
      clearShaderFallback(tileId: string): void;
    },
    /** The info log the wall's next sky compile fails with; null = it compiles. */
    failLog: null as string | null,
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

/** Boot main.ts on `plugin:<id>` (the saved profile mode), with that one pack installed under `name`. */
async function bootOn(id: string, name: string): Promise<void> {
  setHarnessFetchOverride((p, method) => {
    if (p === "/api/plugins") return json({ dir: "", schema: "", plugins: [skyPack(id, name)], errors: [] });
    if (p === "/api/profiles/user" && method === "GET") return json({ settings: { mode: `plugin:${id}` } });
    if (/^\/api\/plugins\/[^/]+\/sky\/fragment\.glsl$/.test(p)) return Promise.resolve(new Response(SKY, { status: 200 }));
    return null;
  });
  localStorage.clear();
  sessionStorage.clear();
  await bootMainEntry();
  await vi.waitFor(() => expect(localStorage.getItem("zoto-viz.mode")).toBe(`plugin:${id}`), { timeout: 8000 });
  // The page's own stylesheet (the harness drops the <link>): the rows read computed visibility from it.
  const css = document.createElement("style");
  css.textContent = readFileSync(resolve(import.meta.dirname, "../../style.css"), "utf8");
  document.head.appendChild(css);
}

const tile = () => document.getElementById("scene")!;

/** The solo tile's pack sky fails to compile on the GPU; the host's tile-shader latch catches it. */
function failSky(id: string, name: string): string | null {
  t.host!.beginTilePack("main", `plugin:${id}`, id, tile(), name, true);
  t.failLog = "ERROR: 0:12: 'uFoo' : undeclared identifier";
  const err = t.host!.probeTileSky("main", new THREE.Scene(), new THREE.PerspectiveCamera());
  t.failLog = null;
  return err;
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
    await bootOn("fluid-dyn", "Fluid Dynamics");
    expect(failSky("fluid-dyn", "Fluid Dynamics"), "the latch caught the failed compile").toBe("shader failed");
    const text = tile().textContent ?? "";
    expect(text).toContain("Fluid Dynamics couldn't draw. Pick another view, or reload to try again.");
    expect(text, "capability copy is not a shader failure").not.toMatch(/can't run its graphics|on this device/);
    expect(text, "solo wall: no 'other tiles'").not.toMatch(/other tiles/i);
  });

  it("labels: the tile's graph labels are hidden while the couldn't-draw line shows, and come back when it clears", { timeout: 30_000 }, async () => {
    await bootOn("fluid-dyn", "Fluid Dynamics");
    const label = graphLabel();
    expect(labelVisibility(label), "before the failure").not.toBe("hidden");
    failSky("fluid-dyn", "Fluid Dynamics");
    expect(tile().textContent ?? "").toContain("couldn't draw");
    expect(labelVisibility(label), "while the line shows").toBe("hidden");
    t.host!.clearShaderFallback("main");
    expect(tile().textContent ?? "").not.toContain("couldn't draw");
    expect(labelVisibility(label), "after it clears").not.toBe("hidden");
  });

  it("name: a pack name with markup reaches the tile as literal, sanitized text (no element), and an empty name is 'This view'", { timeout: 60_000 }, async () => {
    const raw = "<img src=x onerror=alert(1)>";
    await bootOn("xss-pack", raw);
    failSky("xss-pack", raw);
    expect(tile().querySelectorAll("img").length, "no element injected from the pack name").toBe(0);
    expect(tile().textContent ?? "").toContain("img src=x onerror=alert(1) couldn't draw. Pick another view, or reload to try again.");
    await new Promise((r) => setTimeout(r, 200));
    // A name that sanitizes to nothing (the catalog won't take an empty one): viewStateCopy says "This view".
    await bootOn("nameless", "<>");
    failSky("nameless", "<>");
    expect(tile().textContent ?? "").toContain("This view couldn't draw. Pick another view, or reload to try again.");
  });
});
