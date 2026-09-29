import { describe, expect, it } from "vitest";
import { matchStyleLibrary, resolveStyleLibrary, styleRecipe } from "./style-library";

describe("style library", () => {
  it("extends a recipe and lets the child override one pin", () => {
    const base = resolveStyleLibrary("jelly-bloom");
    const child = resolveStyleLibrary("jelly-bundle");
    expect(base.fabric).toBe("jelly");
    expect(base.graphLayout).toBe("bloom");
    expect(child.fabric).toBe("jelly");
    expect(child.graphLayout).toBe("bloom");
    expect(child.graphLinks).toBe("bundle");
    expect(child.animated).toBe(true);
    expect(child.space).toBe("3d");
  });

  it("combines ids left to right and lets a patch win", () => {
    const mixed = resolveStyleLibrary(["orbit-helix", "neon-halo"], { fabric: "wire" });
    expect(mixed.graphLayout).toBe("halo");
    expect(mixed.graphLinks).toBe("both");
    expect(mixed.fabric).toBe("wire");
    expect(mixed.ids).toEqual(["orbit-helix", "neon-halo"]);
  });

  it("reports an unknown id and still applies the known ones", () => {
    const resolved = resolveStyleLibrary(["nope", "voxel-bars"]);
    expect(resolved.unknown).toEqual(["nope"]);
    expect(resolved.fabric).toBe("voxels");
    expect(resolved.animated).toBe(false);
    expect(styleRecipe("voxel-bars")?.space).toBe("3d");
  });

  it("matches a look that is exactly one recipe", () => {
    const pins = resolveStyleLibrary("tornado-vortex");
    expect(matchStyleLibrary(pins)).toBe("tornado-vortex");
    expect(matchStyleLibrary({ ...pins, fabric: "cloth" })).toBeUndefined();
  });
});
