import { describe, expect, it } from "vitest";
import { FLOOR_SHAPES, easeFloorPose, floorPose, type FloorPose } from "./floor";

describe("FLOOR_SHAPES", () => {
  it("includes hex and the packed set", () => {
    expect(FLOOR_SHAPES.map((o) => o.value)).toEqual(["square", "hex", "triangle", "diamond", "circle"]);
  });
});

describe("floorPose", () => {
  it("sits under the live graph so camera moves keep tiles and nodes together", () => {
    const p = floorPose({ x: 120, y: 40, z: -80, hx: 300, hz: 220, n: 12 });
    expect(p.x).toBe(120);
    expect(p.z).toBe(-80);
    expect(p.y).toBeLessThan(40);
    expect(p.fadeFar).toBeGreaterThan(300);
    expect(p.scaleX).toBeGreaterThan(0);
    expect(p.scaleZ).toBe(p.scaleX);
  });

  it("stays at the origin before any nodes have a focus box", () => {
    const p = floorPose({ x: 50, y: 10, z: 20, hx: 280, hz: 280, n: 0 });
    expect(p).toMatchObject({ x: 0, z: 0 });
  });

  it("blends world-fixed and graph-locked poses along follow", () => {
    const g = { x: 200, y: 40, z: -80, hx: 300, hz: 220, n: 8 };
    const world = floorPose(g, 0, 1);
    const glued = floorPose(g, 1);
    const mid = floorPose(g, 0.5);
    expect(world).toMatchObject({ x: 0, y: -320, z: 0, fadeFar: 1220 });
    expect(glued.x).toBe(200);
    expect(mid.x).toBeCloseTo(100);
    expect(mid.z).toBeCloseTo(-40);
    expect(mid.y).toBeGreaterThan(world.y);
    expect(mid.y).toBeLessThan(glued.y);
  });
});

describe("easeFloorPose", () => {
  const cur: FloorPose = { x: 0, y: -200, z: 0, scaleX: 1, scaleZ: 1, fadeFar: 800 };

  it("slides xz toward the target", () => {
    const next = easeFloorPose(cur, { ...cur, x: 100, z: -40 }, 0.5);
    expect(next.x).toBeCloseTo(50);
    expect(next.z).toBeCloseTo(-20);
  });

  it("holds scale and fade through small focus jitter", () => {
    const next = easeFloorPose(cur, { ...cur, scaleX: 1.08, scaleZ: 1.08, fadeFar: 860, y: -210 }, 1);
    expect(next.scaleX).toBe(1);
    expect(next.scaleZ).toBe(1);
    expect(next.fadeFar).toBe(800);
    expect(next.y).toBe(-200);
  });

  it("eases a real scale jump instead of snapping every frame", () => {
    const next = easeFloorPose(cur, { ...cur, scaleX: 1.4, scaleZ: 1.4, fadeFar: 1200 }, 0.5);
    expect(next.scaleX).toBeGreaterThan(1);
    expect(next.scaleX).toBeLessThan(1.4);
    expect(next.fadeFar).toBeGreaterThan(800);
    expect(next.fadeFar).toBeLessThan(1200);
  });
});
