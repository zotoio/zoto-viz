import { describe, expect, it } from "vitest";
import { buildKoiPondScenery } from "./koi-pond-scenery";

describe("koi pond scenery", () => {
  it("builds basin, reflective water, fountain and lotus placeholders", () => {
    const { root, update } = buildKoiPondScenery();
    const names: string[] = [];
    root.traverse((o) => {
      if (o.name) names.push(o.name);
    });
    expect(names).toContain("koi-pond-scenery");
    expect(names).toContain("koi-basin-bed");
    expect(names).toContain("koi-basin-kerb");
    expect(names).toContain("koi-water-reflector");
    expect(names).toContain("koi-fountain-jet");
    expect(names.some((n) => n.startsWith("koi-lotus-"))).toBe(true);

    const slots = new Float32Array(64);
    slots[1] = 0.8; // clarity
    slots[7] = 3; // lotus count
    slots[9] = 1; // bloom on
    update((s, i) => (s === 0 ? slots[i]! : 0), 1 / 60);
    const lotus = root.getObjectByName("koi-lotus-0")!;
    expect(lotus.visible).toBe(true);
  });
});
