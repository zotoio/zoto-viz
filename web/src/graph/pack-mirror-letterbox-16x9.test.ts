import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { zotoSurfacePanelClearHex } from "../core/themes";
import { getSurfaceLetterboxFill, letterboxFillHex } from "./letterbox-fill";
import { PackTexturePresenter, type MirrorRenderer, type PackMirrorHostGl } from "./pack-mirror-gl";
import { asCanvasDeviceHeight } from "./pack-mirror-rect";
import { mockPartial } from "../../test-support/mock-partial";
import {
  LETTERBOX_SCENE_ASPECT,
  LETTERBOX_TILE_CSS,
  letterbox16x9FirstSceneRowDeviceY,
  letterbox16x9InnerViewportGl,
} from "./pack-mirror-letterbox-16x9.fixture";

describe("pack mirror 16:9 letterbox (production presenter)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  const surfaceClear = zotoSurfacePanelClearHex();
  const fill = getSurfaceLetterboxFill(surfaceClear, 0.25);
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
      const viewports: { x: number; y: number; w: number; h: number }[] = [];
      const clearColors: number[] = [];
      const presenter = new PackTexturePresenter();
      const renderer = mockPartial<MirrorRenderer>({
        setScissorTest: vi.fn(),
        setViewport: vi.fn((x: number, y: number, w: number, h: number) => {
          viewports.push({ x, y, w, h });
        }),
        setScissor: vi.fn(),
        setClearColor: vi.fn((hex: number) => { clearColors.push(hex); }),
        clear: vi.fn(),
        getPixelRatio: () => 1,
        setRenderTarget: vi.fn(),
        render: vi.fn(),
      });
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
      expect(clearColors.every((c) => c === barClearHex)).toBe(true);
      presenter.dispose();
    },
  );
});
