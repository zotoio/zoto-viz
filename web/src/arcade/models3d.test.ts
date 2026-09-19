import { describe, expect, it } from "vitest";
import {
  makeBuilding,
  makeCompanionCube,
  makeGhost,
  makeLighthouse,
  makePacman,
  makePortalRing,
  makeSatellite,
  makeShip,
  makeTetBlock,
  makeTurret,
} from "./models3d";

function parts(g: { children: unknown[] }): number {
  return g.children.length;
}

describe("models3d", () => {
  it("builds multi-part craft and graph models", () => {
    expect(parts(makeLighthouse(0xffcc80))).toBeGreaterThan(6);
    expect(parts(makeShip(0x29b6f6))).toBeGreaterThan(5);
    expect(parts(makeSatellite(0x90caf9))).toBeGreaterThan(5);
    expect(parts(makeBuilding(0x78909c, 8))).toBeGreaterThan(6);
  });

  it("builds arcade figures with eyes or frames", () => {
    expect(parts(makePacman())).toBeGreaterThan(3);
    expect(parts(makeGhost(0xef5350))).toBeGreaterThan(6);
    expect(parts(makeTetBlock(0x42a5f5))).toBe(2);
    expect(parts(makePortalRing(0xff6d00))).toBeGreaterThan(8);
    expect(parts(makeCompanionCube())).toBeGreaterThan(8);
    expect(parts(makeTurret(0x90a4ae))).toBeGreaterThan(5);
  });
});
