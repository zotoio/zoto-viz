import { setPreserveVizUbo } from "./viz-ubo-preserve";

/** Called from switchPaneView when ensureReviewed fails (mosaic/header/settings picks). */
export function onMosaicSwitchConsentDenied(): void {
  setPreserveVizUbo(false);
}
