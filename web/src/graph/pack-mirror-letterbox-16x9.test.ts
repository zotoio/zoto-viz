import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { DEFAULT_THEME } from "../core/themes";
import { getSurfaceLetterboxFill, letterboxFillHex } from "./letterbox-fill";
import { PackTexturePresenter, type PackMirrorHostGl } from "./pack-mirror-gl";
import { asCanvasDeviceHeight } from "./pack-mirror-rect";
import { describe, expect, it, vi } from "vitest";
import { zotoSurfacePanelClearHex } from "../core/themes";
import { letterboxFillHex, surfaceLetterboxFill } from "./letterbox-fill";
import { PackTexturePresenter } from "./pack-mirror-gl";
import {
  LETTERBOX_SCENE_ASPECT,
  LETTERBOX_TILE_CSS,
  letterbox16x9FirstSceneRowDeviceY,
  letterbox16x9InnerViewportGl,
} from "../../test-support/pack-mirror-letterbox-16x9.fixture";

describe("pack mirror 16:9 letterbox (production presenter)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  const surfaceClear = DEFAULT_THEME.scene.clear;
  const fill = getSurfaceLetterboxFill(surfaceClear, 0.25);
  letterbox16x9InnerViewportBottomLeft,
} from "./pack-mirror-letterbox-16x9.fixture";

describe("pack mirror 16:9 letterbox (production presenter)", () => {
  const surfaceClear = zotoSurfacePanelClearHex();
  const fill = surfaceLetterboxFill(surfaceClear, 0.25);
  const barClearHex = letterboxFillHex(fill);
  const dst = { x: 0, y: 0, w: LETTERBOX_TILE_CSS, h: LETTERBOX_TILE_CSS, __unit: "css" as const };

  it.each([1, 1.5])(
    "1:1 tile pr %s: centred inner GL viewport, first scene row offset, surface panel bar clear",
    (pr) => {
      const expectedVp = letterbox16x9InnerViewportGl(pr);
      const expectedFirstRow = letterbox16x9FirstSceneRowDeviceY(pr);
      const hostGl: PackMirrorHostGl = {
        layoutPixelRatio: pr,
        canvasCssHeight: LETTERBOX_TILE_CSS,
        canvasDeviceHeight: asCanvasDeviceHeight(Math.round(LETTERBOX_TILE_CSS * pr)),
      };
      const expectedVp = letterbox16x9InnerViewportBottomLeft();
      const expectedFirstRow = letterbox16x9FirstSceneRowDeviceY(pr);
      const viewports: { x: number; y: number; w: number; h: number }[] = [];
      const clearColors: number[] = [];
      const presenter = new PackTexturePresenter();
      const renderer = {
        setScissorTest: vi.fn(),
        setViewport: vi.fn((x: number, y: number, w: number, h: number) => {
          viewports.push({ x, y, w, h });
        }),
        setScissor: vi.fn(),
        setClearColor: vi.fn((hex: number) => { clearColors.push(hex); }),
        clear: vi.fn(),
        getPixelRatio: () => 1,
        getPixelRatio: () => pr,
        setRenderTarget: vi.fn(),
        render: vi.fn(),
        getContext: () => null,
      };
      const tex = new THREE.Texture();
      presenter.draw(
        renderer,
        tex,
        dst,
        fill,
        LETTERBOX_SCENE_ASPECT,
        { letterbox: true },
        hostGl,
      );
      const contentVp = viewports.at(-1);
      expect(contentVp).toEqual(expectedVp);
      expect(contentVp!.y + contentVp!.h).toBe(expectedFirstRow);
      expect(viewports.length).toBe(3);
      );
      const contentVp = viewports.find((v) => v.w === expectedVp.w && Math.abs(v.h - expectedVp.h) < 0.001);
      expect(contentVp).toEqual(expectedVp);
      expect(Math.round((contentVp!.y + contentVp!.h) * pr)).toBe(expectedFirstRow);
      expect(clearColors.length).toBeGreaterThan(0);
      expect(clearColors.every((c) => c === barClearHex)).toBe(true);
      presenter.dispose();
    },
  );
});
