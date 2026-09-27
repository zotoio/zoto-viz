import { paintPackAssetPaneNotice } from "../plugins/pack-asset-pane-notice";

const SKY_CONSENT_MSG = "Plugin sky needs source review consent before it can load.";

export function showPluginSkyConsentNotice(hostEl: HTMLElement | null, on: boolean): void {
  if (!hostEl) return;
  paintPackAssetPaneNotice(hostEl, on ? SKY_CONSENT_MSG : null, "fail");
}

export function warnPluginSkyConsent(packId: string): void {
  console.warn(`zoto-viz plugin sky: ${packId} — ${SKY_CONSENT_MSG}`);
}
