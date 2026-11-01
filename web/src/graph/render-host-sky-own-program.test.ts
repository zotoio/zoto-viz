/**
 * A plugin sky is judged on its own program. three calls `debug.onShaderError` once per program, on
 * first use: a broken sky compiled before comes back from the program cache with no callback (only
 * `diagnostics.runnable` says so), and a stale broken material still in the scene fires the callback
 * for its program, not the sky being installed. Before this, the cached broken sky was accepted (the
 * backdrop kept it and the next pack was blamed for its error), and a good pack loaded next to a stale
 * one went cant-draw with the stale pack's log.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { mockPartial } from "../../test-support/mock-partial";
import { RenderHostTileShader, type RenderHostShaderGpu } from "./render-host-tile-shader";

type Hook = ((gl: object, program: unknown, vs: object, fs: object) => void) | null;
type Prog = { program: object; diagnostics?: { runnable: boolean; fragmentShader: { log: string } }; getUniforms?(): unknown };

const gl = mockPartial<WebGL2RenderingContext>({
  isContextLost: () => false,
  getShaderInfoLog: () => "ERROR: 0:71: 'notDefinedAnywhere' : undeclared identifier",
  getProgramInfoLog: () => "",
});

/** A renderer stand-in: `compile` fires the hook for `firing` programs, `properties` maps materials to programs. */
function stubRenderer(programs: Map<THREE.Material, Prog>, firing: object[]) {
  const debug: { checkShaderErrors: boolean; onShaderError: Hook } = { checkShaderErrors: true, onShaderError: null };
  return {
    debug,
    getContext: () => gl,
    properties: { get: (m: THREE.Material) => ({ currentProgram: programs.get(m) }) },
    compile: () => {
      for (const p of firing) debug.onShaderError?.(gl, p, {}, {});
    },
  };
}

function shaderHost(renderer: RenderHostShaderGpu["renderer"]): RenderHostTileShader {
  const host: RenderHostShaderGpu = { renderer, software: false, glContextLost: false, invalidate() {} };
  const wall = document.createElement("div");
  document.body.appendChild(wall);
  return new RenderHostTileShader(wall, host);
}

describe("plugin sky compile is judged on the sky's own program", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();

  it("a broken sky from the program cache (no onShaderError) still fails", () => {
    const sky = new THREE.ShaderMaterial();
    const programs = new Map<THREE.Material, Prog>([
      [sky, { program: {}, diagnostics: { runnable: false, fragmentShader: { log: "ERROR: 'notDefinedAnywhere'" } } }],
    ]);
    const tiles = shaderHost(stubRenderer(programs, []));
    tiles.beginTilePack("main", "zz-broken-sky:abc", "zz-broken-sky", document.createElement("div"), "Broken", true);
    expect(tiles.probeTileSky("main", scene, camera, () => {}, sky)).toBe("shader failed");
    expect(tiles.tileShaderDead("main")).toBe(true);
  });

  it("a never-drawn broken sky fails at the probe: compile() alone does not check it, first use does", () => {
    const raw = { id: "fresh-program" };
    const sky = new THREE.ShaderMaterial();
    const renderer = stubRenderer(new Map(), []);
    const fresh = {
      program: raw,
      getUniforms: () => renderer.debug.onShaderError?.(gl, raw, {}, {}),
    };
    renderer.properties.get = (m: THREE.Material) => ({ currentProgram: m === sky ? fresh : undefined });
    const tiles = shaderHost(renderer);
    const seen: string[] = [];
    tiles.onDrawEvent((e) => { if (e.type === "shader-failed") seen.push(e.log); });
    tiles.beginTilePack("main", "zz-broken-sky:abc", "zz-broken-sky", document.createElement("div"), "Broken", true);
    expect(tiles.probeTileSky("main", scene, camera, () => {}, sky)).toBe("shader failed");
    expect(seen[0]).toContain("notDefinedAnywhere");
  });

  it("a stale broken material's error is not pinned on a good sky", () => {
    const stale = { id: "stale-program" };
    const good = new THREE.ShaderMaterial();
    const programs = new Map<THREE.Material, Prog>([[good, { program: {}, diagnostics: { runnable: true, fragmentShader: { log: "" } } }]]);
    const tiles = shaderHost(stubRenderer(programs, [stale]));
    tiles.beginTilePack("main", "fractal-zoom:def", "fractal-zoom", document.createElement("div"), "Fractal Zoom", true);
    expect(tiles.probeTileSky("main", scene, camera, () => {}, good)).toBeNull();
    expect(tiles.tileShaderDead("main")).toBe(false);
  });

  it("the sky's own first-use failure fails it with its own log", () => {
    const raw = { id: "sky-program" };
    const sky = new THREE.ShaderMaterial();
    const programs = new Map<THREE.Material, Prog>([[sky, { program: raw }]]);
    const tiles = shaderHost(stubRenderer(programs, [raw]));
    const seen: string[] = [];
    tiles.onDrawEvent((e) => { if (e.type === "shader-failed") seen.push(e.log); });
    tiles.beginTilePack("main", "zz-broken-sky:abc", "zz-broken-sky", document.createElement("div"), "Broken", true);
    expect(tiles.probeTileSky("main", scene, camera, () => {}, sky)).toBe("shader failed");
    expect(seen[0]).toContain("notDefinedAnywhere");
  });

  it("without a material (or a renderer with no properties) any shader error still fails, as before", () => {
    const tiles = shaderHost({ ...stubRenderer(new Map(), [{}]), properties: undefined });
    tiles.beginTilePack("main", "p:1", "p", document.createElement("div"), "P", true);
    expect(tiles.probeTileSky("main", scene, camera, () => {})).toBe("shader failed");
  });
});
