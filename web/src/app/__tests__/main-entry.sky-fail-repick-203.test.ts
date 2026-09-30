/** @vitest-environment happy-dom */
/**
 * #203, through the production entry (main.ts): boot on Calm Sky, pick a pack whose sky fails to compile,
 * then pick Calm Sky again. The failed install drops the tile's previous sky (the backdrop clears it on a
 * compile error) and leaves the host's shader fallback up ("… can't run its graphics on this device …").
 * Before the fix main.ts still believed Calm Sky was installed (`skyLoaded` / `skyInstalled`), so the
 * re-pick returned early: no reinstall, so the tile had no Calm Sky at all, and the stale fallback line
 * stayed on it. The row checks both: Calm Sky compiles and is the main tile's sky again, and the line is gone.
 * The fake GL context fails a compile the way three.js does (renderer.debug.onShaderError) when the
 * probed sky is the broken pack's, and compiles Calm Sky's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebGLProgram as ThreeWebGLProgram } from "three";
import type { RenderHost } from "../../graph/render-host";
import type { NetScene } from "../../graph/scene";
import { bootMainEntry, pickModeFromUi, setHarnessFetchOverride } from "./main-entry-harness";

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
    /** Each probed sky compile, in order: "calm" compiled, "broken" failed. */
    probed: string[] = [];
    /** Every NetScene main.ts builds (the solo wall's is tile "main"). */
    scenes: NetScene[] = [];
  }
  return { FakeGl, box: new Box() };
});

vi.mock("../../graph/render-host", async (orig) => {
  const real = await orig<typeof import("../../graph/render-host")>();
  const THREE = await import("three");
  const { mockPartial } = await import("../../../test-support/mock-partial");
  /** The fragment shaders of the sky materials a compile would build. */
  const fragments = (root: InstanceType<typeof THREE.Object3D>): string[] => {
    const out: string[] = [];
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats: unknown[] = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m instanceof THREE.ShaderMaterial) out.push(m.fragmentShader);
    });
    return out;
  };
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
        compile: (root: InstanceType<typeof THREE.Object3D>) => {
          if (!("debug" in rd)) return;
          const onShaderError = rd.debug.onShaderError;
          if (!onShaderError) return;
          const broken = fragments(root).some((f) => f.includes("vDirr"));
          t.box.probed.push(broken ? "broken" : "calm");
          if (broken) onShaderError(rd.getContext(), mockPartial<ThreeWebGLProgram>({}), {}, {});
        },
      });
      t.box.host = this;
    }
  }
  return { ...real, RenderHost: WallGlHost };
});

vi.mock("../../graph/scene", async (orig) => {
  const real = await orig<typeof import("../../graph/scene")>();
  class RecordedScene extends real.NetScene {
    constructor(...args: ConstructorParameters<typeof real.NetScene>) {
      super(...args);
      t.box.scenes.push(this);
    }
  }
  return { ...real, NetScene: RecordedScene };
});

/** The sky material on the main tile's far-field sphere (null: no pack sky installed). */
const mainSky = () => t.box.scenes.find((s) => s.tileId === "main")?.pluginSkyId ?? null;

const CALM_SKY = "void main() { fragColor = vec4(normalize(vDir) * 0.123, 1.0); }";
const BROKEN_SKY = "void main() { fragColor = vec4(normalize(vDirr), 1.0); }";
const CALM = "plugin:calm-sky";
const BROKEN = "plugin:broken-sky";

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
    if (p === "/api/plugins") {
      return json({ dir: "", schema: "", plugins: [skyPack("calm-sky", "Calm Sky"), skyPack("broken-sky", "Broken Sky")], errors: [] });
    }
    if (p === "/api/profiles/user" && method === "GET") return json({ settings: { mode: CALM } });
    if (p === "/api/plugins/calm-sky/sky/fragment.glsl") return Promise.resolve(new Response(CALM_SKY, { status: 200 }));
    if (p === "/api/plugins/broken-sky/sky/fragment.glsl") return Promise.resolve(new Response(BROKEN_SKY, { status: 200 }));
    return null;
  });
}

const fallbackText = () => document.querySelector("#scene .tile-shader-fallback")?.textContent ?? null;
const headerLabel = () => document.querySelector("#mode button.field-btn")?.textContent ?? "";

describe("#203: a failed sky install never leaves the previous sky's state behind (main.ts)", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    sessionStorage.clear();
    t.box.host = null;
    t.box.probed = [];
    t.box.scenes = [];
  });

  afterEach(async () => {
    setHarnessFetchOverride(null);
    // Let the previous main.ts's debounced session write (80 ms) land, then wipe it.
    await new Promise((r) => setTimeout(r, 200));
    localStorage.clear();
    sessionStorage.clear();
  });

  it("calm-sky, then a pack whose sky fails, then calm-sky: Calm Sky is installed again and the fallback line is gone (#203)", { timeout: 40_000 }, async () => {
    serve();
    await bootMainEntry();
    // Imported after the boot: bootMainEntry resets modules, so only now is this the view-state main.ts writes to.
    const { viewStateOf } = await import("../view-state");
    expect(t.box.host?.canvas.hasAttribute("data-softgl"), "the wall draws through a GL host").toBe(false);
    await vi.waitFor(() => {
      expect(headerLabel()).toContain("Calm Sky");
      expect(t.box.probed, "Calm Sky compiled at boot").toEqual(["calm"]);
    }, { timeout: 8000 });
    expect(fallbackText(), "no fallback on a sky that compiled").toBeNull();
    expect(mainSky(), "Calm Sky is the main tile's sky at boot").toBe("calm-sky");

    await pickModeFromUi(BROKEN);
    await vi.waitFor(() => {
      expect(viewStateOf("main"), "the broken pick").toMatchObject({ kind: "cant-draw", reason: "shader", packId: "broken-sky" });
      expect(fallbackText(), "the failed sky's fallback line").toContain("on this device");
    }, { timeout: 8000 });
    // The failed install took Calm Sky off the sphere too (QE: the calm sky itself goes missing).
    expect(mainSky(), "no pack sky on the tile after the failed install").toBeNull();

    const probedBefore = t.box.probed.length;
    await pickModeFromUi(CALM);
    await vi.waitFor(() => {
      expect(headerLabel()).toContain("Calm Sky");
      expect(t.box.probed.slice(probedBefore), "Calm Sky is installed (compiled) again on the re-pick").toEqual(["calm"]);
    }, { timeout: 8000 });
    // Let the switch settle, then nothing of the failed install is left on the tile.
    await new Promise((r) => setTimeout(r, 300));
    expect(mainSky(), "Calm Sky is the main tile's sky again").toBe("calm-sky");
    expect(fallbackText(), "fallback line after the re-pick").toBeNull();
    expect(viewStateOf("main")?.kind, "the tile's state after the re-pick").not.toBe("cant-draw");
    expect(document.getElementById("scene")?.dataset.viewId, "the tile shows Calm Sky").toBe(CALM);
  });
});
