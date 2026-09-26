import { describe, expect, it } from "vitest";
import {
  buildPacMaze,
  gerstner,
  carouselBeat,
  carouselPlayhead,
  carouselPoint,
  kenBurnsAim,
  kenBurnsAt,
  kenBurnsTransform,
  carouselSpinFor,
  carouselStillScale,
  fitStillSize,
  planeCoverScale,
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

  it("walks a carousel spiral outward and up", () => {
    const a = carouselPoint(0, 8, 0);
    const b = carouselPoint(7, 8, 0);
    expect(Math.hypot(b[0], b[2])).toBeGreaterThan(Math.hypot(a[0], a[2]));
    expect(b[1]).toBeGreaterThan(a[1]);
    const spun = carouselPoint(0, 8, carouselSpinFor(2, 8));
    const front = carouselPoint(2, 8, carouselSpinFor(2, 8));
    expect(front[0]).toBeGreaterThan(0);
    expect(Math.abs(front[2])).toBeLessThan(0.2);
    expect(Math.hypot(spun[0], spun[2])).toBeGreaterThan(6);
  });

  it("zooms and pans a still then crossfades", () => {
    const a = kenBurnsAim("nasa:nebula");
    const b = kenBurnsAim("nasa:moon");
    expect(Math.hypot(a.x, a.y)).toBeGreaterThan(0.5);
    expect(a.x).not.toBeCloseTo(b.x);
    const rest = kenBurnsAt(0, a);
    expect(rest.scale).toBe(1);
    expect(rest.x).toBeCloseTo(0);
    expect(rest.y).toBeCloseTo(0);
    const end = kenBurnsAt(1, a);
    expect(end.scale).toBeCloseTo(1.16);
    expect(end.x).toBeCloseTo(a.x);
    expect(kenBurnsTransform(end)).toContain("scale(1.1600)");
    const mid = carouselPlayhead(9, 18, 2.8);
    expect(mid.cycle).toBe(0);
    expect(mid.fade).toBe(0);
    expect(mid.progress).toBeCloseTo(0.5);
    const leave = carouselPlayhead(17, 18, 2.8);
    expect(leave.fade).toBeGreaterThan(0.4);
    expect(leave.fade).toBeLessThan(1);
    expect(carouselPlayhead(18, 18, 2.8).cycle).toBe(1);
    expect(carouselPlayhead(18, 18, 2.8).fade).toBe(0);
  });

  it("holds a zoomed still with caption before travelling to the next", () => {
    const start = carouselBeat(0, 10);
    expect(start.phase).toBe("in");
    expect(start.zoom).toBe(0);
    expect(start.caption).toBe(0);
    const mid = carouselBeat(4, 10);
    expect(mid.phase).toBe("hold");
    expect(mid.zoom).toBe(1);
    expect(mid.caption).toBe(1);
    expect(mid.travel).toBe(0);
    const leave = carouselBeat(9, 10);
    expect(leave.phase).toBe("out");
    expect(leave.zoom).toBeLessThan(0.5);
    expect(leave.travel).toBeGreaterThan(0.5);
  });

  it("covers a perspective frustum and grows as the camera backs away", () => {
    const close = planeCoverScale(3, 50, 16 / 9, 3.15, 2.05);
    const far = planeCoverScale(12, 50, 16 / 9, 3.15, 2.05);
    expect(far).toBeGreaterThan(close);
    expect(close).toBeGreaterThan(1);
    expect(planeCoverScale(4.7, 50, 16 / 9, 3.15, 2.05)).toBeGreaterThan(2);
    expect(carouselStillScale(0, 4, 0.86)).toBeCloseTo(0.86);
    expect(carouselStillScale(1, 4, 0.86)).toBeCloseTo(4);
    expect(carouselStillScale(0.5, 4, 0.86)).toBeCloseTo(2.43);
  });

  it("fits NASA-wide stills without stretching", () => {
    const wide = fitStillSize(16 / 9, 3.15, 2.05);
    expect(wide.w).toBeCloseTo(3.15);
    expect(wide.h).toBeCloseTo(3.15 / (16 / 9));
    expect(wide.w / wide.h).toBeCloseTo(16 / 9);
    const tall = fitStillSize(3 / 4, 3.15, 2.05);
    expect(tall.h).toBeCloseTo(2.05);
    expect(tall.w / tall.h).toBeCloseTo(3 / 4);
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
