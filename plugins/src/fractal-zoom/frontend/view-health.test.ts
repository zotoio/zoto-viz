import { describe, expect, it } from "vitest";
import FRAG from "../sky/fragment.glsl?raw";
import { canyonRayOrigin, packFractalDrive, resetFractalDrive } from "./drive";
import { FRACTAL_PRESETS } from "./options";
import { de3 } from "../../../sdk/fractal-cruise";
import { FZ_SLOT } from "../../../sdk/fractal-slot";

const ptr = () => ({ yaw: 0, pitch: 0, zoomWheel: 0, dragging: false });
const params = (a: number[]) => ({ power: a[FZ_SLOT.power]!, scale: a[FZ_SLOT.scale]!, fold: a[FZ_SLOT.fold]!, sym: a[FZ_SLOT.kaleidoSym]!,
  jx: a[FZ_SLOT.juliaCr]!, jy: a[FZ_SLOT.juliaCi]!, jz: a[FZ_SLOT.quatC2]!, jw: a[FZ_SLOT.quatC3]! });

describe("fractal zoom: every 3D type keeps the view outside the surface", () => {
  for (const pr of FRACTAL_PRESETS.filter((p) => !["mandel2d", "julia2d", "mandel3d"].includes(p.type))) {
    it(`${pr.type}: shader ray origin stays outside the solid over 60 s of cruise`, () => {
      resetFractalDrive();
      const cfg = { preset: pr.id, fractalType: pr.type };
      let inside = 0;
      let frames = 0;
      for (let f = 1; f <= 60 * 60; f++) {
        const d = packFractalDrive(f / 60, 1 / 60, 0.2, 1.6, cfg, ptr());
        const a = d.slot0;
        if (f < 30) continue;
        const ro = canyonRayOrigin({ fx: a[FZ_SLOT.focusX]!, fy: a[FZ_SLOT.focusY]!, fz: a[FZ_SLOT.focusZ]!, cx: a[FZ_SLOT.camX]!, cy: a[FZ_SLOT.camY]!, cz: a[FZ_SLOT.camZ]!,
          vx: 0, vy: 0, vz: 0, heading: 0, near: a[FZ_SLOT.nearDist]! });
        const de = de3(a[FZ_SLOT.fractalType]!, ro[0], ro[1], ro[2], params(a));
        if (!(de > 0.002)) inside++;
        frames++;
      }
      // A frame or two right at a reseed is fine; seconds inside the solid (the black Mandelbox) is not.
      expect(inside / frames).toBeLessThan(0.005);
    });
  }
});

describe("fractal zoom shader: slow distance fields get a step budget and a pixel-sized hit test", () => {
  it("gives Mandelbulb / Mandelbox / quaternion Julia more steps and a distance-relative epsilon", () => {
    expect(FRAG).toMatch(/bool slowDe = typ < 1\.5 \|\| \(typ > 3\.5 && typ < 4\.5\)/);
    expect(FRAG).toMatch(/for \(int i = 0; i < 72; i\+\+\)/);
    expect(FRAG).toMatch(/float eNow = max\(eHit, t \* pixK\)/);
    // A ray that ends its budget hugging the surface is shaded, not filled with aura.
    expect(FRAG).toMatch(/last && d0i < max\(eNow \* 6\.0, t \* 0\.01\)/);
  });
});
