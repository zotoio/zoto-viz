import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { PackTexturePresenter, type PackMirrorHostGl } from "./pack-mirror-gl";
import { letterboxInnerRectInto, surfaceLetterboxFill } from "./letterbox-fill";
import { asCanvasDeviceHeight, deviceRectFromHostViewBoxInto, toGlRectInto } from "./pack-mirror-rect";

describe("pack mirror letterbox", () => {
  it("places letterbox inner viewport with bottom-left origin", () => {
    const presenter = new PackTexturePresenter();
    const dst = { x: 10, y: 20, w: 100, h: 80 };
    const innerTd = { x: 0, y: 0, w: 0, h: 0 };
    letterboxInnerRectInto(dst, 1.25, innerTd);
    const ix = dst.x + innerTd.x;
    const iy = dst.y + (dst.h - innerTd.y - innerTd.h);
    const iw = innerTd.w;
    const ih = innerTd.h;
    const hostGl: PackMirrorHostGl = {
      layoutPixelRatio: 1,
      canvasCssHeight: 120,
      canvasDeviceHeight: asCanvasDeviceHeight(120),
    };
    const dev = { x: 0, y: 0, w: 0, h: 0 };
    deviceRectFromHostViewBoxInto({ x: ix, y: iy, w: iw, h: ih }, false, 120, 1, dev, hostGl.canvasDeviceHeight);
    const gl = { x: 0, y: 0, w: 0, h: 0 };
    toGlRectInto(dev as never, hostGl.canvasDeviceHeight, gl);
    const expectIy = gl.y;

    let viewportY = -1;
    const renderer = {
      setScissorTest: vi.fn(),
      setViewport: vi.fn((_x: number, y: number) => { viewportY = y; }),
      setScissor: vi.fn(),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      getPixelRatio: () => 1,
      setRenderTarget: vi.fn(),
      render: vi.fn(),
      getContext: () => null,
    };
    const tex = new THREE.Texture();
    presenter.draw(
      renderer,
      tex,
      dst,
      surfaceLetterboxFill(0x0a1020, 0.25),
      1.25,
      { letterbox: true },
      hostGl,
    );
    expect(viewportY).toBe(expectIy);
    presenter.dispose();
  });
});
