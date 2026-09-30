/** @vitest-environment happy-dom */
/**
 * #171 (c) / #179, through the production entry (main.ts): a pack sky that fails to compile ends on its
 * tile as `{ kind: "cant-draw", reason: "shader", packId }`. The saved boot mode is the pack (the
 * profile path: /api/profiles/user -> ProfileStore.boot -> applySettings -> applyMode), main.ts
 * installs its sky (installPluginSky -> installTileSkyShader -> NetScene.setPluginShader with the
 * pack), the shared host probes the compile, and the fake GL context reports a compile error the way
 * three.js does (renderer.debug.onShaderError). Before the fix main.ts installed the sky without its
 * pack, so the host never began the tile's pack or probed it, and the failure never reached ViewState.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderHost } from "../../graph/render-host";
import { bootMainEntry, setHarnessFetchOverride } from "./main-entry-harness";

const t = vi.hoisted(() => {
  class FakeGl {
    constructor(readonly canvas: HTMLCanvasElement) {
      // Every GL call this row doesn't care about is a no-op that hands back null.
      return new Proxy(this, {
        get: (target, key, recv) => (key in target ? Reflect.get(target, key, recv) : () => null),
      });
    }
    isContextLost(): boolean { return false; }
    fenceSync(): null { return null; }
    getContextAttributes(): { antialias: boolean } { return { antialias: false }; }
    getExtension(): null { return null; }
    getShaderInfoLog(): string { return "ERROR: 0:7: 'vDirr' : undeclared identifier"; }
    getProgramInfoLog(): string { return ""; }
  }
  class Box {
    host: RenderHost | null = null;
    /** Compiles that saw a probe listening (renderer.debug.onShaderError set). */
    probedCompiles = 0;
  }
  return { FakeGl, box: new Box() };
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
      const rd = this.renderer;
      Object.assign(rd, {
        getContext: () => gl,
        forceContextLoss: () => {},
        forceContextRestore: () => {},
        render: () => {},
        // three.js reports a failed program through renderer.debug.onShaderError during compile;
        // `debug` is only there once the host's probe has put its listener on it.
        compile: () => {
          if (!("debug" in rd)) return;
          const onShaderError = rd.debug.onShaderError;
          if (!onShaderError) return;
          t.box.probedCompiles += 1;
          // Only the context is read by the probe; three's program / shader objects are opaque to it,
          // so they are stand-ins here (Reflect.apply: a fake GL has no real ones to pass).
          Reflect.apply(onShaderError, undefined, [rd.getContext(), {}, {}, {}]);
        },
      });
      t.box.host = this;
    }
  }
  return { ...real, RenderHost: WallGlHost };
});

const SKY = "void main() { fragColor = vec4(normalize(vDirr), 1.0); }";
const BACKROOMS = "plugin:backrooms";

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

function serve(): void {
  setHarnessFetchOverride((p, method) => {
    if (p === "/api/plugins") return json({ dir: "", schema: "", plugins: [skyPack("backrooms", "NET Backrooms")], errors: [] });
    if (p === "/api/profiles/user" && method === "GET") return json({ settings: { mode: BACKROOMS } });
    if (/^\/api\/plugins\/backrooms\/sky\/fragment\.glsl$/.test(p)) return Promise.resolve(new Response(SKY, { status: 200 }));
    return null;
  });
}

describe("#171 (c) / #179: a pack sky that fails to compile, through main.ts", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    sessionStorage.clear();
    t.box.host = null;
    t.box.probedCompiles = 0;
  });

  afterEach(async () => {
    setHarnessFetchOverride(null);
    // Let the previous main.ts's debounced session write (80 ms) land, then wipe it.
    await new Promise((r) => setTimeout(r, 200));
    localStorage.clear();
    sessionStorage.clear();
  });

  it("the main tile ends as cant-draw / shader with the pack's id and the compile log (#171 c, #179)", { timeout: 30_000 }, async () => {
    serve();
    await bootMainEntry();
    // Imported after the boot: bootMainEntry resets modules, so only now is this the view-state main.ts writes to.
    const { viewStateOf } = await import("../view-state");
    expect(t.box.host?.canvas.hasAttribute("data-softgl"), "the wall draws through a GL host").toBe(false);
    await vi.waitFor(() => {
      expect(t.box.probedCompiles, "the host probed the pack sky's compile").toBeGreaterThan(0);
      expect(viewStateOf("main"), "main tile").toEqual({
        kind: "cant-draw",
        reason: "shader",
        packId: "backrooms",
        log: "ERROR: 0:7: 'vDirr' : undeclared identifier",
      });
    }, { timeout: 8000 });
    // Settled: nothing after the failure (the switch's own error handling, the sky wait) writes over it.
    await new Promise((r) => setTimeout(r, 300));
    expect(viewStateOf("main"), "main tile after the switch settled").toEqual({
      kind: "cant-draw",
      reason: "shader",
      packId: "backrooms",
      log: "ERROR: 0:7: 'vDirr' : undeclared identifier",
    });
    expect(document.querySelectorAll("#scene .tile-shader-fallback").length, "the tile's fallback is up").toBe(1);
  });
});
