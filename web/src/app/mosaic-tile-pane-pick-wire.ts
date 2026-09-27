export type MosaicTilePanePickHandler = (
  fromId: string,
  toId: string,
) => boolean | Promise<boolean>;

/** Connect mosaic tile chrome picks to the same path as settings slots (`pickMosaicPane` → `switchPaneView`). */
export function wireMosaicTilePanePick(handler: MosaicTilePanePickHandler): MosaicTilePanePickHandler {
  return handler;
}
