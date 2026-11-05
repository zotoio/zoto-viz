import { describe, expect, it } from "vitest";
import { buildKoiPondScenery } from "./koi-pond-scenery";

describe("koi pond scenery", () => {
  it("builds reflective water and fountain jet over the Blender scape", () => {
    const { root, update } = buildKoiPondScenery();
    const names: string[] = [];
    root.traverse((o) => {
      if (o.name) names.push(o.name);
    });
    expect(names).toContain("koi-pond-scenery");
    expect(names).toContain("koi-water-reflector");
    expect(names).toContain("koi-water-tint");
    expect(names).toContain("koi-fountain-jet");
    // Basin / kerb / lotus come from the pinned Blender scape, not three.js stand-ins.
    expect(names).not.toContain("koi-basin-bed");
    expect(names).not.toContain("koi-basin-kerb");
    expect(names.some((n) => n.startsWith("koi-lotus-"))).toBe(false);

    const slots = new Float32Array(64);
    slots[1] = 0.8; // clarity
    update((s, i) => (s === 0 ? slots[i]! : 0), 1 / 60);
    expect(root.getObjectByName("koi-fountain-jet")).toBeTruthy();
  });
});
