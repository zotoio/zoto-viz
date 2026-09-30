import { describe, expect, it, vi } from "vitest";
import { compileAgentSky, wrapAgentSky } from "./sky-agent";

describe("wrapAgentSky", () => {
  it("wraps a color() function and rejects empty or banned source", () => {
    const ok = wrapAgentSky("vec3 color(vec3 dir, float t) { return mix(uBg, uAccent, 0.5 + 0.5 * dir.y); }");
    expect(ok).toHaveProperty("frag");
    if ("frag" in ok) {
      expect(ok.frag).toContain("vec3 color");
      expect(ok.frag).toContain("void main()");
      expect(ok.frag).toContain("uniform float uTime");
      expect(ok.frag).toContain("capSkyLuma");
    }
    expect(wrapAgentSky("")).toEqual({ error: "empty shader" });
    const loop = wrapAgentSky("vec3 color(vec3 dir, float t) { while(true) {} }");
    expect("error" in loop && loop.error).toMatch(/blocked/i);
    const bare = wrapAgentSky("float n = 1.0;");
    expect("error" in bare && bare.error).toMatch(/color/i);
  });

  it("passes a void main fragment through the preamble", () => {
    const ok = wrapAgentSky("void main() { fragColor = vec4(uAccent, uOpacity); }");
    expect("frag" in ok && ok.frag.includes("void main()")).toBe(true);
  });

  it("skips compile when WebGL2 is missing", () => {
    expect(compileAgentSky("vec3 color(vec3 dir, float t) { return uAccent; }")).toBeNull();
  });

  it("releases the compile context", () => {
    const lose = vi.fn();
    const gl = {
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      createShader: () => ({}),
      shaderSource() {},
      compileShader() {},
      getShaderParameter: () => true,
      getShaderInfoLog: () => "",
      getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: lose } : null),
    };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      if (type === "webgl2") return gl as never;
      return orig.call(this, type as never);
    } as typeof orig;
    try {
      expect(compileAgentSky("vec3 color(vec3 dir, float t) { return uAccent; }")).toBeNull();
      expect(lose).toHaveBeenCalledOnce();
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });
});
