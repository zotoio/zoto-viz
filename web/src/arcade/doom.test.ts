import { describe, expect, it } from "vitest";
import { blocked, buildMaze, castRay, chaseStep, cpuNameId, isWall, remainFade, rocketHit, rocketStop, spawnPose, splashIds, sprayGibs, spriteHit, stepGib } from "./doom";
import { viewSource } from "../core/modes";
import { doomArt, fogRgba, pixCanvas, TEX } from "./doom-tex";
import { DoomSfx } from "./doom-sfx";

describe("cpu doom maze", () => {
  it("carves a corridor loop with cores on it", () => {
    const maze = buildMaze(8);
    expect(maze.rooms.length).toBe(8);
    expect(maze.wall.length).toBe(maze.h);
    const room = maze.rooms[0]!;
    expect(isWall(maze, room.x, room.y)).toBe(false);
    expect(isWall(maze, 0, 0)).toBe(true);
    expect(isWall(maze, maze.w / 2, maze.h / 2)).toBe(true);
    expect(isWall(maze, 1.5, 1.5)).toBe(false);
    const pose = spawnPose(maze);
    expect(blocked(maze, pose.x, pose.y)).toBe(false);
    const far = maze.rooms[maze.rooms.length - 1]!;
    const step = chaseStep(maze, 1.5, 1.5, far.x, far.y);
    expect(step).not.toBeNull();
    expect(isWall(maze, step!.x, step!.y)).toBe(false);
    expect(Math.hypot(step!.x - 1.5, step!.y - 1.5)).toBeLessThan(1.6);
    expect(chaseStep(maze, 1.5, 1.5, 1.5, 1.5)).toBeNull();
  });

  it("casts a ray into a wall and hits a sprite in front", () => {
    const maze = buildMaze(4);
    const hit = castRay(maze, 1.5, 1.5, 1, 0);
    expect(hit.dist).toBeGreaterThan(1);
    expect(spriteHit(1.5, 1.5, 1, 0, [{ id: "proc:1", x: 2.3, y: 1.5 }], 8)?.id).toBe("proc:1");
    expect(spriteHit(1.5, 1.5, 1, 0, [{ id: "proc:1", x: 1.5, y: 3.5 }], 8)).toBeNull();
    expect(cpuNameId("Chrome Helper")).toMatch(/^proc:name:/);
    expect(viewSource({ id: "doom" })).toBe("CPU");
  });

  it("flies a rocket into a process and splash-hits neighbours", () => {
    expect(rocketHit(1.5, 1.5, 3.5, 1.5, [{ id: "proc:1", x: 2.5, y: 1.5 }])?.id).toBe("proc:1");
    expect(rocketHit(1.5, 1.5, 3.5, 1.5, [{ id: "proc:1", x: 2.5, y: 3.5 }])).toBeNull();
    expect(splashIds(2, 1.5, [{ id: "a", x: 2.2, y: 1.5 }, { id: "b", x: 5, y: 1.5 }], 1)).toEqual(["a"]);
    const bits = sprayGibs(1.5, 1.5, 0, 8);
    expect(bits).toHaveLength(8);
    expect(bits.every((g) => g.z > 0)).toBe(true);
    const maze = buildMaze(4);
    const chunk = sprayGibs(1.5, 1.15, 0, 1)[0]!;
    chunk.dx = 0; chunk.dy = -12; chunk.vz = 0;
    const before = chunk.dy;
    for (let i = 0; i < 10; i++) stepGib(maze, chunk, 0.04);
    expect(chunk.dy).toBeGreaterThan(before);
    const rest = sprayGibs(1.5, 1.5, 0, 1)[0]!;
    rest.z = 0; rest.vz = 0; rest.dx = 0.04; rest.dy = 0.04;
    for (let i = 0; i < 20; i++) stepGib(maze, rest, 0.05);
    expect(rest.z).toBe(0);
    expect(rest.dx).toBe(0);
    expect(rest.dy).toBe(0);
    expect(remainFade(0, 20)).toBe(1);
    expect(remainFade(19, 20)).toBeLessThan(1);
    expect(remainFade(20, 20)).toBe(0);
  });

  it("stops the camera and rockets on brick, not through it", () => {
    const maze = buildMaze(8);
    const hit = castRay(maze, 1.5, 1.5, 0, -1);
    expect(hit.dist).toBeGreaterThan(0.2);
    expect(hit.dist).toBeLessThan(1.1);
    expect(hit.wallX).toBeGreaterThanOrEqual(0);
    expect(hit.wallX).toBeLessThan(1);
    expect(isWall(maze, 1.5, 1.5 - hit.dist - 0.05)).toBe(true);
    expect(blocked(maze, 1.5, 1.5)).toBe(false);
    expect(blocked(maze, 0.2, 0.2)).toBe(true);
    const into = rocketStop(maze, 3.5, 1.5, 0, 1, 2);
    expect(into.wall).toBe(true);
    expect(into.dist).toBeLessThan(1);
    expect(isWall(maze, into.x, into.y + 0.08)).toBe(true);
    const hall = rocketStop(maze, 1.5, 1.5, 1, 0, 0.4);
    expect(hall.wall).toBe(false);
    expect(isWall(maze, hall.x, hall.y)).toBe(false);
  });

  it("builds 64px textures and paletted sprites", () => {
    const art = doomArt();
    expect(art.startan.width).toBe(TEX);
    expect(art.stone.height).toBe(TEX);
    expect(art.gibs.length).toBe(3);
    expect(art.blood.width).toBeGreaterThan(4);
    const c = pixCanvas([".#.", ".#."], { ".": null, "#": [255, 0, 0] });
    expect(c.width).toBe(3);
    const g = c.getContext("2d");
    if (g) {
      const d = g.getImageData(0, 0, 3, 2).data;
      expect(d[3]).toBe(0);
      expect(d[7]).toBe(255);
    }
    expect((fogRgba(0x00ff00ff, 0.5) & 255)).toBeGreaterThan(0);
  });

  it("does not throw when audio is missing", () => {
    const sfx = new DoomSfx();
    sfx.fire();
    sfx.boom(1);
    sfx.gib(1);
    sfx.stop();
    expect(sfx.ready).toBe(false);
  });

  it("does not open AudioContext while sound is off", async () => {
    const { liveSound } = await import("../audio/sound");
    liveSound.setOn(false, false);
    const sfx = new DoomSfx();
    sfx.resume();
    sfx.fire();
    expect(sfx.ready).toBe(false);
    sfx.stop();
  });
});
