import { describe, expect, it, vi } from "vitest";
import { pluginShaderError, probePluginSkyCompile, wrapPluginSky } from "./plugin-sky-probe";

const packSkyFrags = import.meta.glob<string>("../../../plugins/src/*/sky/fragment.glsl", {
  query: "?raw",
  import: "default",
  eager: true,
});

function packIdFromPath(p: string): string {
  const m = p.match(/plugins\/src\/([^/]+)\/sky\/fragment\.glsl$/);
  return m?.[1] ?? p;
}

describe("shipped pack sky fragments (host)", () => {
  const entries = Object.entries(packSkyFrags).sort(([a], [b]) => a.localeCompare(b));

  it("discovers shipped pack sky fragments", () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  for (const [path, raw] of entries) {
    const packId = packIdFromPath(path);
    it(`wraps and compiles ${packId} sky/fragment.glsl`, () => {
      const wrapped = wrapPluginSky(raw);
      expect("error" in wrapped).toBe(false);
      if ("error" in wrapped) return;
      expect(wrapped.frag).toContain("zotoVizSlots");
      const gpuErr = probePluginSkyCompile(wrapped.frag);
      expect(gpuErr).toBeNull();
    });
  }

  it("backrooms: rejects non-whitelisted uniform immediately after #version", () => {
    const raw = packSkyFrags["../../../plugins/src/backrooms/sky/fragment.glsl"];
    expect(raw).toBeTruthy();
    const broken = `#version 300 es\nuniform float evilUniform;\n${raw}`;
    expect(pluginShaderError(broken)).toMatch(/evilUniform/);
    const wrapped = wrapPluginSky(broken);
    expect("error" in wrapped).toBe(true);
    if (!("error" in wrapped)) return;
    expect(wrapped.error).toContain("evilUniform");
  });

  it("backrooms: rejects non-whitelisted uniform in body (no #version line)", () => {
    const raw = packSkyFrags["../../../plugins/src/backrooms/sky/fragment.glsl"];
    expect(raw).toBeTruthy();
    const lines = raw!.split("\n");
    const broken = [lines[0], "uniform float evilUniform;", ...lines.slice(1)].join("\n");
    expect(pluginShaderError(broken)).toMatch(/evilUniform/);
    const wrapped = wrapPluginSky(broken);
    expect("error" in wrapped).toBe(true);
  });

  it("backrooms: compile probe fails on undeclared body identifier", () => {
    const raw = packSkyFrags["../../../plugins/src/backrooms/sky/fragment.glsl"];
    expect(raw).toBeTruthy();
    const broken = raw!.replace(
      /void\s+main\s*\(\s*\)\s*\{/,
      "void main() { float x = zotoUndeclaredCompileBreaker; ",
    );
    const wrapped = wrapPluginSky(broken);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;

    const lose = vi.fn();
    const gl = {
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      createShader: () => ({}),
      shaderSource() {},
      compileShader() {},
      getShaderParameter: () => false,
      getShaderInfoLog: () => "ERROR: undeclared identifier zotoUndeclaredCompileBreaker",
      getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: lose } : null),
    };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type === "webgl2") return gl as never;
      return orig.call(this, type as never);
    } as typeof orig;
    try {
      const gpuErr = probePluginSkyCompile(wrapped.frag);
      expect(gpuErr).not.toBeNull();
      expect(gpuErr).toContain("zotoUndeclaredCompileBreaker");
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });
});
