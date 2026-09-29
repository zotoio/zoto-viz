import { describe, expect, it } from "vitest";
import { EdgeSheath, edgeHalfWidth } from "./edge-sheath";

describe("edge sheath", () => {
  it("grows thickness with the weight and stays inside the slider", () => {
    expect(edgeHalfWidth(1)).toBeCloseTo(0.85);
    expect(edgeHalfWidth(1.55)).toBeGreaterThan(edgeHalfWidth(0.3));
    expect(edgeHalfWidth(9)).toBeCloseTo(edgeHalfWidth(2.5));
  });

  it("writes a wider ribbon when the half-width grows", () => {
    const width = (half: number) => {
      const sheath = new EdgeSheath();
      sheath.write(0, 0, 0, 0, 10, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0.4, 0.2, half, 0, 5, 20);
      const pos = sheath.mesh.geometry.getAttribute("position")!.array as Float32Array;
      const across = sheath.mesh.geometry.getAttribute("across")!.array as Float32Array;
      expect(across[0]).toBe(-1);
      expect(across[1]).toBe(1);
      return Math.hypot(pos[0]! - pos[3]!, pos[1]! - pos[4]!, pos[2]! - pos[5]!);
    };
    expect(width(3)).toBeGreaterThan(width(1) * 2);
    const bent = new EdgeSheath();
    const pts = [
      { x: 0, y: 0, z: 0, r: 1, g: 1, b: 1, along: 0 },
      { x: 4, y: 3, z: 0, r: 1, g: 1, b: 1, along: 0.5 },
      { x: 8, y: 0, z: 0, r: 1, g: 1, b: 1, along: 1 },
    ];
    expect(bent.writeCurve(0, pts, 3, 0.2, 0.1, 0.4, 0, 0, 20)).toBe(2);
    const pos = bent.mesh.geometry.getAttribute("position")!.array as Float32Array;
    expect(pos[6]).toBeCloseTo(pos[12]!);
    expect(pos[7]).toBeCloseTo(pos[13]!);
    expect(pos[8]).toBeCloseTo(pos[14]!);
    const sheath = new EdgeSheath();
    sheath.commit(0, { time: 1, opacity: 0.5, speed: 1, amt: 1, mode: 0 });
    const opacity = (sheath.mesh.material as { uniforms: { uOpacity: { value: number } } }).uniforms.uOpacity.value;
    expect(opacity).toBe(0.5);
  });
});
