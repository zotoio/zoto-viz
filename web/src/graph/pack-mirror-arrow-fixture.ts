/** Lopsided pack-mirror fixture: labelled arrow in the top-left corner (QE + stub orientation). */
export const PACK_MIRROR_ARROW_W = 32;
export const PACK_MIRROR_ARROW_H = 24;

export function paintPackMirrorArrow(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#0a1020";
  ctx.fillRect(0, 0, PACK_MIRROR_ARROW_W, PACK_MIRROR_ARROW_H);
  ctx.fillStyle = "#ff5533";
  ctx.beginPath();
  ctx.moveTo(2, 2);
  ctx.lineTo(14, 2);
  ctx.lineTo(14, 8);
  ctx.lineTo(22, 8);
  ctx.lineTo(11, 18);
  ctx.lineTo(11, 12);
  ctx.lineTo(2, 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#e8eef8";
  ctx.font = "bold 7px sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("TL", 2, 2);
}

export function createPackMirrorArrowCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PACK_MIRROR_ARROW_W;
  canvas.height = PACK_MIRROR_ARROW_H;
  const ctx = canvas.getContext("2d");
  if (ctx) paintPackMirrorArrow(ctx);
  return canvas;
}

export async function createPackMirrorArrowBitmap(): Promise<ImageBitmap> {
  const canvas = createPackMirrorArrowCanvas();
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(canvas);
  }
  const bmp = Object.create(ImageBitmap.prototype) as ImageBitmap;
  Object.defineProperties(bmp, {
    width: { value: PACK_MIRROR_ARROW_W },
    height: { value: PACK_MIRROR_ARROW_H },
    close: { value: () => {} },
  });
  return bmp;
}
