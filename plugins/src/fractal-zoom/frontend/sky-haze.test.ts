import { describe, expect, it } from "vitest";
import FRAG from "../sky/fragment.glsl?raw";

/** The 3D sky's miss haze: mist + aura used to be added unbounded and washed rays to pale fog. */
function haze(mist: number, aura: number, cap: number): number {
  return Math.min(cap, 1 - Math.exp(-(mist + aura) * 0.8));
}

describe("fractal-zoom 3D sky haze and shading", () => {
  const cap = Number(/const float FZ_GLOW_CAP = ([\d.]+);/.exec(FRAG)?.[1]);

  it("caps how far a missed ray is lit by mist and aura", () => {
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(0.6);
    // glow 0.9, ray grazing the surface at the start of the march: the old sum was ~2.8 (white).
    const mist = Math.exp(-0.2 * 0.22) * (0.45 + 0.9 * 0.55);
    const aura = Math.exp(0) * (0.55 + 0.9);
    expect(mist + aura).toBeGreaterThan(2);
    expect(haze(mist, aura, cap)).toBeLessThanOrEqual(cap);
  });

  it("blends the haze instead of adding it past 1", () => {
    expect(FRAG).not.toMatch(/\*\s*\(mist \+ aura\)\s*\*\s*\(1\.0 - hit\)/);
    expect(FRAG).toMatch(/col = mix\(col, mapCol\([^;]+\), haze\);/);
  });

  it("takes surface normals by central differences with a facing fallback", () => {
    expect(FRAG).toMatch(/mapDE\(p - vec3\(ne, 0\.0, 0\.0\)/);
    expect(FRAG).toMatch(/dot\(g, g\) > 1e-14 \? normalize\(g\) : -rd/);
    expect(FRAG).toMatch(/max\(dot\(n, -rd\), 0\.0\)/);
  });
});
