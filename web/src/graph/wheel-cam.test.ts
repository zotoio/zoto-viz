import { describe, expect, it } from "vitest";
import { wheelCamMotion } from "./wheel-cam";

describe("wheelCamMotion", () => {
  it("treats ctrl/meta wheel as pinch zoom", () => {
    expect(wheelCamMotion({ ctrlKey: true, metaKey: false, deltaX: 0, deltaY: 4, deltaMode: 0 })).toEqual({ zoom: 4, yaw: 0 });
    expect(wheelCamMotion({ ctrlKey: false, metaKey: true, deltaX: 1, deltaY: 3, deltaMode: 0 })).toEqual({ zoom: 3, yaw: 0 });
  });

  it("treats mouse-wheel ticks as zoom", () => {
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 120, deltaMode: 0 })).toEqual({ zoom: 120, yaw: 0 });
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: -3, deltaMode: 1 })).toEqual({ zoom: -3, yaw: 0 });
  });

  it("zooms on two-finger forward/back and orbits on sideways drag", () => {
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 6.5, deltaMode: 0 })).toEqual({ zoom: 6.5, yaw: 0 });
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: 12, deltaY: 4, deltaMode: 0 })).toEqual({ zoom: 4, yaw: 12 });
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: -8, deltaY: 0, deltaMode: 0 })).toEqual({ zoom: 0, yaw: -8 });
  });
});
