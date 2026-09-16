import { describe, expect, it } from "vitest";
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
});
