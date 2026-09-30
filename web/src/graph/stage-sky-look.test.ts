import { describe, expect, it } from "vitest";
import { perfOverlay, type PerfSrc } from "../core/perf";
import { skyLookFor } from "./stage-sky-look";

/**
 * #189: skyLookFor has one path for every view (H1's stage-only exemption is gone; it was dead
 * since #177). What proves it: across a sweep of sky sliders and perf stress, the sliders it hands
 * applyLook are the look's own, exactly, leaned or not, with or without an overlay. There is no
 * view argument left, so a graph view and a stage-only view get the same answer by construction.
 *
 * Reverts: put the sky dim back into perfOverlay (skyBright -> 0.4, skyOpacity -> 0.45 at stress 1)
 * -> red (with the exemption gone nothing shields any view). Putting the exemption back (d158d708's
 * stage-sky-look.ts, scene.ts and ant-colony-sky.test.ts) leaves this row and the sky / lean rows
 * green: the behaviour is unchanged, which is why it was dead code.
 */
describe("skyLookFor: one path for every view (#189)", () => {
  const src = (skyBright: number, skyOpacity: number): PerfSrc => ({
    labelCount: 20, partAmt: 1, partCap: 400, partPeak: 24, partSize: 1, edgeGlowAmt: 1, skySpeed: 0.35, skyBright, skyOpacity,
  });

  it("hands applyLook the look's own sky sliders at every perf stress 0-1, leaned or not (1,386 slider x stress cases)", () => {
    const brights = Array.from({ length: 14 }, (_, i) => 0.1 + i * 0.1); // 0.1 .. 1.4
    const opacities = Array.from({ length: 9 }, (_, i) => 0.2 + i * 0.1); // 0.2 .. 1.0
    const stresses = Array.from({ length: 11 }, (_, i) => i / 10); // 0 .. 1
    let cases = 0;
    const differ: string[] = [];
    for (const skyBright of brights) for (const skyOpacity of opacities) {
      const anim = { skyBright, skyOpacity };
      const bare = skyLookFor(anim, null);
      if (bare.bright !== skyBright || bare.opacity !== skyOpacity) differ.push(`no overlay ${skyBright}/${skyOpacity} -> ${bare.bright}/${bare.opacity}`);
      for (const stress of stresses) {
        cases++;
        const got = skyLookFor(anim, perfOverlay(src(skyBright, skyOpacity), stress));
        if (got.bright !== skyBright || got.opacity !== skyOpacity) differ.push(`stress ${stress} look ${skyBright.toFixed(2)}/${skyOpacity.toFixed(2)} -> ${got.bright.toFixed(3)}/${got.opacity.toFixed(3)}`);
      }
    }
    expect(cases).toBe(14 * 9 * 11);
    expect(differ.length, `${differ.length} of ${cases} cases leave the look's sliders: ${differ.slice(0, 4).join("; ")}`).toBe(0);
  });
});
