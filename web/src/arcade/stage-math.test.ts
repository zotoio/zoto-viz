import { describe, expect, it } from "vitest";
import {
  buildPacMaze,
  gerstner,
  helixPoint,
  mazeOpens,
  mazeStep,
  normalizeCells,
  orbitRadius,
  portalTravel,
  rotateCells,
  skylineHeight,
  tetrominoForProto,
  TETROMINOES,
} from "./stage-math";

describe("stage-math", () => {
  it("sums Gerstner trains with amplitude", () => {
    const still = gerstner(2, 3, 0, 0);
    expect(still).toEqual([0, 0, 0]);
    const a = gerstner(2, 3, 1.2, 1.5);
    expect(a[1]).not.toBe(0);
    expect(Math.abs(a[1])).toBeLessThan(3);
  });

  it("places helix strands opposite each other", () => {
    const a = helixPoint(0, 8, 0);
    const b = helixPoint(0, 8, 1);
    expect(Math.hypot(a[0] + b[0], a[2] + b[2])).toBeLessThan(0.01);
    expect(a[1]).toBeCloseTo(b[1]);
  });

  it("keeps the gateway at the solar centre", () => {
    expect(orbitRadius("gateway", 0, 4)).toBe(0);
    expect(orbitRadius("lan", 0, 4)).toBeGreaterThan(orbitRadius("self", 0, 4));
    expect(orbitRadius("internet", 0, 4)).toBeGreaterThan(orbitRadius("lan", 0, 4));
  });

  it("grows skyline towers with rate and history", () => {
    expect(skylineHeight(0, 0)).toBeCloseTo(1.2);
    expect(skylineHeight(800, 50_000)).toBeGreaterThan(skylineHeight(2, 10));
    expect(skylineHeight(1e9, 1e9)).toBeLessThanOrEqual(18);
  });

  it("maps protocols onto tetrominoes and rotates cells", () => {
    expect(Object.keys(TETROMINOES)).toContain(tetrominoForProto("tls"));
    expect(tetrominoForProto("tls")).toBe(tetrominoForProto("TLS"));
    const rot = normalizeCells(rotateCells([[0, 0], [1, 0], [2, 0], [3, 0]], 1));
    expect(rot).toHaveLength(4);
    expect(new Set(rot.map(([x, y]) => `${x},${y}`)).size).toBe(4);
  });

  it("carves a bordered pac-man maze with a cross corridor", () => {
    const wall = buildPacMaze(15, 13);
    expect(wall.length).toBe(13);
    expect(wall[0]!.every(Boolean)).toBe(true);
    const opens = mazeOpens(wall);
    expect(opens.length).toBeGreaterThan(20);
    const midY = (wall.length / 2) | 0;
    expect(wall[midY]![1]).toBe(false);
    const [nx, ny, dir] = mazeStep(wall, 1, midY, 2);
    expect(dir).toBe(2);
    expect(nx).toBe(wall[0]!.length - 2);
    expect(ny).toBe(midY);
  });

  it("teleports a portal path through the rings", () => {
    const start = portalTravel([0, 0, 0], [1, 0, 0], [4, 0, 0], [5, 0, 0], 0);
    expect(start).toEqual([0, 0, 0]);
    const mid = portalTravel([0, 0, 0], [1, 0, 0], [4, 0, 0], [5, 0, 0], 0.5);
    expect(mid[0]).toBeGreaterThan(1);
    expect(mid[0]).toBeLessThan(4);
    const end = portalTravel([0, 0, 0], [1, 0, 0], [4, 0, 0], [5, 0, 0], 1);
    expect(end).toEqual([5, 0, 0]);
  });
});
