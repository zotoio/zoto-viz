import type { Settings } from "../ui/settings";

export type MosaicPanePickHandler = (
  fromId: string,
  toId: string,
) => boolean | Promise<boolean>;

/** Connect Settings wall-slot picks to the same path as mosaic chrome (switchPaneView + consent). */
export function wireSettingsMosaicPanePick(
  settings: Settings,
  handler: MosaicPanePickHandler,
): void {
  settings.onMosaicPanePick = handler;
}
