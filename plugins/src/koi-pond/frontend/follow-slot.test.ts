import { describe, expect, it } from "vitest";
import { demoFrame, KoiPondSim, KOI_SLOT3, parseKoiPondOptions } from "./koi-pond";

describe("koi follow slot3 (occasional)", () => {
  it("writes follow eye/aim into slot3 when engaged", () => {
    const sim = new KoiPondSim(
      parseKoiPondOptions({
        followCam: "true",
        cameraDrift: "true",
        swimSpeed: "0.38",
        reducedMotion: "false",
      }),
    );
    // Force engage immediately
    sim.followEngage.nextStart = 0;
    sim.followEngage.engaged = false;
    let saw = false;
    for (let i = 0; i < 90; i++) {
      const packed = sim.advance(demoFrame(i * (1 / 60)), 1280, 800);
      if (packed.slot3[KOI_SLOT3.follow] >= 0.5) {
        expect(packed.slot3[KOI_SLOT3.fov]).toBeGreaterThan(20);
        expect(Number.isFinite(packed.slot3[KOI_SLOT3.eye])).toBe(true);
        expect(Number.isFinite(packed.slot3[KOI_SLOT3.aim])).toBe(true);
        saw = true;
        break;
      }
    }
    expect(saw).toBe(true);
  });

  it("stays off when followCam is false", () => {
    const sim = new KoiPondSim(parseKoiPondOptions({ followCam: "false", cameraDrift: "true" }));
    sim.followEngage.nextStart = 0;
    for (let i = 0; i < 60; i++) {
      const packed = sim.advance(demoFrame(i * (1 / 60)), 1280, 800);
      expect(packed.slot3[KOI_SLOT3.follow]).toBe(0);
    }
  });
});
