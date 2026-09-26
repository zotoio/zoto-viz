import { describe, expect, it } from "vitest";
import {
  blendStereoParts, packStereoScene, parseStereoRecipe, STEREO_PART_FLOATS, STEREO_PARTS, StereoScenePlayer,
} from "../../../plugins/src/stereo-gram/frontend/recipe";

const orb = {
  name: "orb", spin: 0.4, bob: 0.05,
  parts: [
    { shape: "ball", at: [0, 0, 0.3], r: 0.14, bin: 0, react: "size", amt: 0.6 },
    { shape: "dent", at: [0, 0.05, 0.42], r: 0.04 },
  ],
};

describe("stereo AI recipe", () => {
  it("parses fenced replies and clamps parts to the view", () => {
    const r = parseStereoRecipe("```json\n" + JSON.stringify({
      name: "x", spin: 9, bob: 1,
      parts: [
        { shape: "capsule", at: [-2, 1, -1], to: [0.1, 0, 0.9], r: 5, bin: 99, react: "stretch", amt: 3 },
        { shape: "box", at: [0.3, -0.2, 0.2], size: [0.2, 0.5], react: "wobble" },
        { shape: "blob", at: [0, 0, 0] },
      ],
    }) + "\n```");
    expect(r).not.toBeNull();
    expect(r!.parts).toHaveLength(2);
    const [cap, box] = r!.parts;
    expect(cap!.at).toEqual([-0.8, 0.38, 0]);
    expect(cap!.to).toEqual([0.1, 0, 0.55]);
    expect(cap!.r).toBe(0.3);
    expect(cap!.bin).toBe(5);
    expect(cap!.amt).toBe(1);
    expect(box!.r).toBeCloseTo(0.1);
    expect(box!.h).toBeCloseTo(0.25);
    expect(box!.react).toBe("none");
    expect(box!.amt).toBe(0);
    expect(r!.bob).toBe(0.1);
    // Wide scenes would swing through the wall, so the turntable stays off.
    expect(r!.spin).toBe(0);
  });

  it("keeps spin for compact objects and rejects scenes without a solid", () => {
    expect(parseStereoRecipe(orb)!.spin).toBeCloseTo(0.4);
    expect(parseStereoRecipe({ parts: [{ shape: "dent", at: [0, 0, 0.3], r: 0.1 }] })).toBeNull();
    expect(parseStereoRecipe("nope")).toBeNull();
    const many = { parts: Array.from({ length: 40 }, () => ({ shape: "ball", at: [0, 0, 0.3], r: 0.05 })) };
    expect(parseStereoRecipe(many)!.parts).toHaveLength(STEREO_PARTS);
  });

  it("packs parts around their centre with a shape, reaction, bin and amount code", () => {
    const r = parseStereoRecipe(orb)!;
    const { head, parts } = packStereoScene(r.parts, 0.7, 0.01);
    expect(parts).toHaveLength(STEREO_PART_FLOATS);
    expect(head.slice(0, 4)).toEqual([1, 2, 0.7, 0.01]);
    expect(head[5]).toBeCloseTo(0.025);
    expect(head[6]).toBeCloseTo(0.36);
    expect(parts[1]).toBeCloseTo(-0.025);
    expect(parts[3]).toBeCloseTo(0.14);
    // ball + 4·size + 20·(bin 0 + 1) + 0.9·0.6
    expect(parts[7]).toBeCloseTo(0 + 4 + 20 + 0.54);
    // dent, no reaction, whole level
    expect(parts[15]).toBe(3);
    const box = packStereoScene(parseStereoRecipe({
      parts: [{ shape: "box", at: [0, 0, 0.2], size: [0.1, 0.4], bin: -1, react: "stretch", amt: 1 }],
    })!.parts, 0, 0).parts;
    expect(box[3]).toBeCloseTo(0.05);
    expect(box[4]).toBeCloseTo(0.2);
    expect(box[7]).toBeCloseTo(2 + 16 + 0 + 0.9);
  });

  it("morphs like the shipped objects: unlike shapes shrink away before the next grows", () => {
    const a = parseStereoRecipe({ parts: [{ shape: "ball", at: [0, 0, 0.3], r: 0.1 }] })!.parts;
    const b = parseStereoRecipe({ parts: [{ shape: "box", at: [0.2, 0, 0.3], size: [0.2, 0.2] }] })!.parts;
    expect(blendStereoParts(a, b, 0.25)[0]).toMatchObject({ shape: "ball", r: 0.05 });
    expect(blendStereoParts(a, b, 0.5)).toHaveLength(0);
    expect(blendStereoParts(a, b, 0.75)[0]!.shape).toBe("box");
    const c = parseStereoRecipe({ parts: [{ shape: "ball", at: [0.2, 0, 0.3], r: 0.3 }] })!.parts;
    const mid = blendStereoParts(a, c, 0.5)[0]!;
    expect(mid.at[0]).toBeCloseTo(0.1);
    expect(mid.r).toBeCloseTo(0.2);
  });

  it("turns on the animation clock and eases a still scene back to face the eye", () => {
    const player = new StereoScenePlayer();
    expect(player.frame(0, 0)).toBeNull();
    const spinner = parseStereoRecipe(orb)!;
    player.show(spinner, 0, 10, 1000);
    const early = player.frame(500, 10)!;
    expect(early.head[0]).toBe(1);
    expect(player.frame(2000, 12)!.head[2]).toBeCloseTo(0.8);
    const still = parseStereoRecipe({ ...orb, spin: 0 })!;
    player.show(still, 2000, 12, 1000);
    expect(player.frame(2000, 12)!.head[2]).toBeCloseTo(0.8);
    expect(player.frame(3500, 20)!.head[2]).toBeCloseTo(0);
  });
});
