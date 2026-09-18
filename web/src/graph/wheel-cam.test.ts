import { describe, expect, it } from "vitest";
import { pinchWheel, pinchZoomDelta, pointerCentroid, THREE_FINGER_ZOOM, threeFingerZoomDelta, wheelCamMotion } from "./wheel-cam";

describe("wheelCamMotion", () => {
  it("zooms on two-finger trackpad drag", () => {
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 6.5, deltaMode: 0 })).toEqual({ zoom: 6.5, panX: 0, panY: 0 });
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: 12, deltaY: 4, deltaMode: 0 })).toEqual({ zoom: 4, panX: 0, panY: 0 });
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: -8, deltaY: 0, deltaMode: 0 })).toEqual({ zoom: -8, panX: 0, panY: 0 });
  });

  it("zooms an angled two-finger drag from X when Y is 0", () => {
    expect(pinchZoomDelta({ deltaX: 5, deltaY: 0 })).toBe(5);
  });

  it("pans on ctrl/meta + two-finger drag in the same direction as a right-button drag", () => {
    expect(wheelCamMotion({ ctrlKey: true, metaKey: false, deltaX: 0, deltaY: 4, deltaMode: 0 })).toEqual({ zoom: 0, panX: 0, panY: -4 });
    expect(wheelCamMotion({ ctrlKey: false, metaKey: true, deltaX: 12, deltaY: 4, deltaMode: 0 })).toEqual({ zoom: 0, panX: -12, panY: -4 });
    expect(wheelCamMotion({ ctrlKey: true, metaKey: false, deltaX: -8, deltaY: 0, deltaMode: 0 })).toEqual({ zoom: 0, panX: 8, panY: 0 });
  });

  it("treats deltaZ as ctrl-pan (same modifier channel as pinch)", () => {
    expect(pinchWheel({ ctrlKey: false, metaKey: false, deltaZ: 2 })).toBe(true);
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: 3, deltaY: 0, deltaZ: 2, deltaMode: 0 })).toEqual({ zoom: 0, panX: -3, panY: 0 });
  });

  it("keeps panning while a ctrl hold is active even without ctrl/meta", () => {
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: 2, deltaY: 3, deltaMode: 0 }, true)).toEqual({ zoom: 0, panX: -2, panY: -3 });
  });

  it("treats mouse-wheel ticks as zoom", () => {
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 120, deltaMode: 0 })).toEqual({ zoom: 120, panX: 0, panY: 0 });
    expect(wheelCamMotion({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: -3, deltaMode: 1 })).toEqual({ zoom: -3, panX: 0, panY: 0 });
  });

  it("maps a three-finger drag down to a zoom-out wheel delta", () => {
    expect(pointerCentroid([{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 40 }])).toEqual({ x: 10, y: 20 });
    expect(pointerCentroid([])).toBeNull();
    expect(threeFingerZoomDelta(10)).toBe(10 * THREE_FINGER_ZOOM);
    expect(threeFingerZoomDelta(-8)).toBe(-8 * THREE_FINGER_ZOOM);
  });
});
