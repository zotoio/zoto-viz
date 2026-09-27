import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/nixie-clock/sky/fragment.glsl?raw";
import {
  pluginSkyVertGlsl,
  probePluginSkyCompile,
  probePluginSkyVertCompile,
  wrapPluginSky,
} from "../graph/backdrop";

let restoreGetContext: (() => void) | null = null;

/** jsdom has no GPU; stub WebGL2 so `probePluginSkyCompile` uses the same throwaway path as production. */
function installThrowawayWebGL2ForCompileProbe(): void {
  const orig = HTMLCanvasElement.prototype.getContext;
  type ShaderRec = { source: string; ok: boolean; log: string };
  const FRAGMENT_SHADER = 0x8b30;
  const VERTEX_SHADER = 0x8b31;
  const COMPILE_STATUS = 0x8b81;
  const shaders = new Map<object, ShaderRec>();

  HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
    if (type !== "webgl2") return orig.call(this, type, ...args) as RenderingContext | null;
    return {
      FRAGMENT_SHADER,
      VERTEX_SHADER,
      COMPILE_STATUS,
      createShader() {
        const sh: ShaderRec = { source: "", ok: true, log: "" };
        shaders.set(sh as object, sh);
        return sh;
      },
      shaderSource(sh: object, src: string) {
        const rec = shaders.get(sh);
        if (rec) rec.source = src;
      },
      compileShader(sh: object) {
        const rec = shaders.get(sh);
        if (!rec) return;
        const bad = /\bfc\s*\./.test(rec.source);
        rec.ok = !bad;
        rec.log = bad ? "'fc' : undeclared identifier" : "";
      },
      getShaderParameter(sh: object, param: number) {
        const rec = shaders.get(sh);
        if (param === COMPILE_STATUS && rec) return rec.ok;
        return true;
      },
      getShaderInfoLog(sh: object) {
        return shaders.get(sh)?.log ?? "";
      },
      getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: () => {} } : null),
    } as WebGL2RenderingContext;
  } as typeof HTMLCanvasElement.prototype.getContext;

  restoreGetContext = () => {
    HTMLCanvasElement.prototype.getContext = orig;
  };
}

function pluginSkyCompileErrorCount(frag: string, vert: string): number {
  let n = 0;
  if (probePluginSkyCompile(frag)) n++;
  if (probePluginSkyVertCompile(vert)) n++;
  return n;
}

describe("nixie-clock sky GLSL", () => {
  beforeEach(() => {
    installThrowawayWebGL2ForCompileProbe();
  });

  afterEach(() => {
    restoreGetContext?.();
    restoreGetContext = null;
  });

  it("A7: wrapped nixie fragment compiles with 0 errors (counting GL probe)", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(pluginSkyCompileErrorCount(wrapped.frag, pluginSkyVertGlsl)).toBe(0);
  });
});
