import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cssHex, paintSoftwareGraph, paintSoftwareMesh, paintSoftwarePluginRain, projectPane, rgba, worldPx } from "./software-draw";

function cam(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(55, 1, 1, 12000);
  c.position.set(0, 200, 400);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  return c;
}

describe("software-draw", () => {
  it("formats packed colours", () => {
    expect(cssHex(0x0b0e14)).toBe("#0b0e14");
    expect(rgba(1, 0, 0, 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("projects the origin into the pane", () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(projectPane(0, 0, 0, cam(), { x: 10, y: 20, w: 200, h: 100 }, out)).toBe(true);
    expect(out.x).toBeGreaterThan(10);
    expect(out.x).toBeLessThan(210);
    expect(out.y).toBeGreaterThan(20);
    expect(out.y).toBeLessThan(120);
  });

  it("rejects a point behind the camera", () => {
    expect(projectPane(0, 200, 2400, cam(), { x: 0, y: 0, w: 100, h: 100 })).toBe(false);
  });

  it("sizes nearer nodes larger", () => {
    const c = cam();
    const rect = { x: 0, y: 0, w: 400, h: 400 };
    const near = worldPx(8, 0, 0, 0, c, rect);
    const far = worldPx(8, 0, 0, -600, c, rect);
    expect(near).toBeGreaterThan(far);
  });

  it("paints a graph onto a 2d canvas", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // happy-dom has no 2d backend
    paintSoftwareGraph(ctx, cam(), { x: 0, y: 0, w: 80, h: 80 }, {
      clearHex: 0x0b0e14,
      rimHex: 0x5aa9ff,
      dark: true,
      nodes: [{ x: 0, y: 0, z: 0, scale: 10, r: 0.3, g: 0.7, b: 1, a: 1, glow: 0.4, selected: true }],
      segs: [{ ax: -20, ay: 0, az: 0, bx: 20, by: 0, bz: 0, r: 0.4, g: 0.6, b: 1 }],
      particles: [{ x: 0, y: 4, z: 0, r: 1, g: 1, b: 1 }],
    });
    const pix = ctx.getImageData(40, 40, 1, 1).data;
    expect(pix[3]).toBeGreaterThan(0);
  });

  it("paints phosphor rain onto a 2d canvas", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintSoftwarePluginRain(ctx, { x: 0, y: 0, w: 80, h: 80 }, 1.2, 0.4, "JEMALLOC");
    const pix = ctx.getImageData(40, 40, 1, 1).data;
    expect(pix[3]).toBeGreaterThan(0);
  });

  it("fills a triangle in perspective when WebGL is missing", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = new Float32Array([0, 8, 0, -12, -6, 0, 12, -6, 0]);
    const col = new Float32Array([1, 0.2, 0.1, 1, 0.2, 0.1, 1, 0.2, 0.1]);
    const idx = new Uint32Array([0, 1, 2]);
    paintSoftwareMesh(ctx, cam(), { x: 0, y: 0, w: 80, h: 80 }, { pos, col, idx, verts: 3, indices: 3 });
    const pix = ctx.getImageData(40, 40, 1, 1).data;
    expect(pix[0] + pix[1] + pix[2]).toBeGreaterThan(20);
  });
});
