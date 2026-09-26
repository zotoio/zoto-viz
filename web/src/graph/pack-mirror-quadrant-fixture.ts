/** Four distinct quadrant colours (TL, TR, BL, BR) for readback orientation at non-1 DPR. */
export const PACK_MIRROR_QUADRANT_W = 32;
export const PACK_MIRROR_QUADRANT_H = 32;

export const PACK_MIRROR_QUADRANT_RGBA = {
  tl: [220, 40, 40, 255] as [number, number, number, number],
  tr: [40, 200, 60, 255] as [number, number, number, number],
  bl: [50, 90, 240, 255] as [number, number, number, number],
  br: [240, 210, 40, 255] as [number, number, number, number],
};

export function paintPackMirrorQuadrants(ctx: CanvasRenderingContext2D): void {
  const hw = PACK_MIRROR_QUADRANT_W / 2;
  const hh = PACK_MIRROR_QUADRANT_H / 2;
  const fill = (x: number, y: number, rgba: [number, number, number, number]) => {
    ctx.fillStyle = `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3] / 255})`;
    ctx.fillRect(x, y, hw, hh);
  };
  fill(0, 0, PACK_MIRROR_QUADRANT_RGBA.tl);
  fill(hw, 0, PACK_MIRROR_QUADRANT_RGBA.tr);
  fill(0, hh, PACK_MIRROR_QUADRANT_RGBA.bl);
  fill(hw, hh, PACK_MIRROR_QUADRANT_RGBA.br);
}

export function createPackMirrorQuadrantCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PACK_MIRROR_QUADRANT_W;
  canvas.height = PACK_MIRROR_QUADRANT_H;
  const ctx = canvas.getContext("2d");
  if (ctx) paintPackMirrorQuadrants(ctx);
  return canvas;
}
