import { describe, expect, it } from "vitest";
import { AQU_PUFF_X, PUFF_MAX_OPACITY, buildAquariumTank, buildEatPuff } from "./aquarium-tank";
import type * as THREE from "three";

describe("eat puff", () => {
  it("is hidden at zero, faint at full strength, and fades with the pack's strength", () => {
    const puff = buildEatPuff();
    puff.update(0, 0, 0, 0, 1 / 60);
    expect(puff.root.visible).toBe(false);
    puff.update(0.2, 0.1, -0.3, 1, 1 / 60);
    expect(puff.root.visible).toBe(true);
    expect(puff.root.position.x).toBeCloseTo(0.2);
    const op = () => ((puff.root.children[0] as THREE.Sprite).material as THREE.SpriteMaterial).opacity;
    expect(op()).toBeCloseTo(PUFF_MAX_OPACITY);
    expect(PUFF_MAX_OPACITY).toBeLessThan(0.5);
    const size0 = puff.root.children[0]!.scale.x;
    puff.update(0.2, 0.1, -0.3, 0.3, 2);
    expect(op()).toBeCloseTo(PUFF_MAX_OPACITY * 0.3);
    expect(puff.root.children[0]!.scale.x).toBeGreaterThan(size0);
    puff.update(0.2, 0.1, -0.3, 0, 1 / 60);
    expect(puff.root.visible).toBe(false);
  });

  it("the tank reads the puff from slot 2", () => {
    const tank = buildAquariumTank();
    const vals: Record<number, number> = { [AQU_PUFF_X]: 0.4, [AQU_PUFF_X + 1]: 0.2, [AQU_PUFF_X + 2]: -0.1, [AQU_PUFF_X + 3]: 0.8 };
    (tank.userData.onSlots as (r: (s: number, i: number) => number, dt: number) => void)((s, i) => (s === 2 ? vals[i] ?? 0 : 0), 1 / 60);
    const puff = tank.getObjectByName("aquarium-eat-puff")!;
    expect(puff.visible).toBe(true);
    expect(puff.position.z).toBeCloseTo(-0.1);
  });
});
