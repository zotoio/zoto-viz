/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { layoutBackingDevicePx } from "../../test-support/layout-device-px-ratio";

describe("layoutBackingDevicePx", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  beforeEach(() => {
    expect.hasAssertions();
  });

  it("rounds CSS pixels to backing-store device pixels at the pinned layout DPR", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 10 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 10 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true, dpr: 1.5 });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    expect(layoutBackingDevicePx(33)).toBe(50);
    host.dispose();
  });
});
