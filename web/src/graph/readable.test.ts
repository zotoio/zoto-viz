import { describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "./scene";
import { cameraDriven, guardReadableAnim, physicsHot, sparksHot, READABLE } from "./readable";

describe("guardReadableAnim", () => {
  it("leaves DEFAULT_DREAM unchanged", () => {
    expect(guardReadableAnim({ ...DEFAULT_DREAM })).toEqual(DEFAULT_DREAM);
  });

  it("is idempotent on a twitchy mix", () => {
    const raw = {
      ...DEFAULT_DREAM,
      follow: true,
      audioCamera: true,
      audioPhysics: true,
      camInertia: 0.1,
      moveEase: 0.05,
      camAudio: 1.8,
      camGaze: 1.6,
      camChange: 1.9,
      zoom: 0.45,
      zoomPeriod: 15,
      gravity: 1.9,
      swirl: 1.8,
      stringAmt: 0.9,
      magnetRange: 1.9,
      magnetCross: -0.95,
      labelWeight: 2,
      labelCount: 120,
      nodeWeight: 2.5,
      partSize: 2.5,
      partSpeed: 3,
      partBusy: 3,
      partAmt: 2,
      partCap: 2420,
    };
    const once = guardReadableAnim(raw);
    expect(guardReadableAnim(once)).toEqual(once);
    expect(once.camInertia).toBe(READABLE.camInertia);
    expect(once.moveEase).toBe(READABLE.moveEase);
    expect(once.camAudio).toBe(READABLE.camAudio);
    expect(once.camGaze).toBe(READABLE.camGaze);
    expect(once.zoomPeriod).toBe(READABLE.zoomPeriod);
    expect(once.gravity).toBe(READABLE.gravity);
    expect(once.swirl).toBe(READABLE.swirl);
    expect(once.stringAmt).toBe(READABLE.stringAmt);
    expect(once.magnetCross).toBe(-READABLE.magnetAbs);
    expect(once.labelWeight).toBe(READABLE.labelWeight);
    expect(once.labelCount).toBe(READABLE.labelCount);
    expect(sparksHot(raw)).toBe(true);
    expect(once.partCap).toBe(READABLE.partCap);
    expect(once.partSize).toBe(READABLE.partSize);
  });

  it("does not floor camera inertia when the orbit is idle", () => {
    const idle = guardReadableAnim({
      ...DEFAULT_DREAM,
      follow: false,
      audioCamera: false,
      camGaze: 0,
      camAudio: 0,
      camInertia: 0.1,
      moveEase: 0.05,
    });
    expect(cameraDriven(idle)).toBe(false);
    expect(idle.camInertia).toBe(0.1);
    expect(idle.moveEase).toBe(0.05);
  });

  it("does not cap gravity when physics is calm", () => {
    const calm = guardReadableAnim({
      ...DEFAULT_DREAM,
      audioPhysics: false,
      gravity: 0.4,
      swirl: 0.2,
      stringAmt: 0.1,
    });
    expect(physicsHot(calm)).toBe(false);
    expect(calm.gravity).toBe(0.4);
  });
});
