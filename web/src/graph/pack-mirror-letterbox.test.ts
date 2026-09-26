import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { PackTexturePresenter } from "./pack-mirror-gl";
import { letterboxInnerRectInto, surfaceLetterboxFill } from "./letterbox-fill";

describe("pack mirror letterbox", () => {
  it("places letterbox inner viewport with bottom-left origin", () => {
    const presenter = new PackTexturePresenter();
    const dst = { x: 10, y: 20, w: 100, h: 80 };
    const innerTd = { x: 0, y: 0, w: 0, h: 0 };
    letterboxInnerRectInto(dst, 1.25, innerTd);
    const expectIy = dst.y + (dst.h - innerTd.y - innerTd.h);

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
    );
    expect(viewportY).toBe(expectIy);
    presenter.dispose();
  });
});
