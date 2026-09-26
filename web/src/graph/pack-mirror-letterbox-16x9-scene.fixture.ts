/** Solid 16:9 scene texture: top row is scene green; used for readback row-offset checks. */
export const LETTERBOX_SCENE_TOP_ROW_RGBA: [number, number, number, number] = [32, 200, 64, 255];

export const LETTERBOX_SCENE_W = 160;
export const LETTERBOX_SCENE_H = 90;

export function createPackMirrorLetterbox16x9Canvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = LETTERBOX_SCENE_W;
  canvas.height = LETTERBOX_SCENE_H;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const [r, g, b, a] = LETTERBOX_SCENE_TOP_ROW_RGBA;
    ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
    ctx.fillRect(0, 0, LETTERBOX_SCENE_W, LETTERBOX_SCENE_H);
  }
  return canvas;
}
