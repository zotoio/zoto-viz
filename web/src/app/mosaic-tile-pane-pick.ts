/** Mosaic tile chrome → host pick handler (`pickMosaicPane` → `switchPaneView` + consent). */
export function mosaicTilePanePickHandler(
  pick: (from: string, to: string) => boolean | Promise<boolean>,
): (from: string, to: string) => boolean | Promise<boolean> {
  return (from, to) => pick(from, to);
}
