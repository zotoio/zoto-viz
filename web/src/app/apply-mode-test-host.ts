import type { Mosaic } from "../graph/mosaic";
import { applyPluginCatalog, type PluginView } from "../plugins/plugin";
import type { ConsentReviewResult } from "./pack-consent";
import type { TileReviewRunner } from "./needs-you";
import { setLastConsentedModeId } from "./mode-switch-state";

export type ApplyModeTestConfig = {
  ensureReviewed?: (spec: PluginView | null, signal: AbortSignal) => Promise<ConsentReviewResult>;
  /** Answer the tile review directly (instead of pressing Review, then a choice, on the tile). */
  review?: TileReviewRunner;
  mosaic?: Mosaic | null;
  pluginSpecs?: PluginView[];
  liveMode?: string;
  lastConsentedMode?: string;
};

type ApplyModeTestBindings = {
  setEnsureReviewedOverride: (fn: ((spec: PluginView | null, signal: AbortSignal) => Promise<ConsentReviewResult>) | null) => void;
  setReviewOverride: (fn: TileReviewRunner | null) => void;
  refreshCatalog: () => Promise<void>;
  setMosaic: (m: Mosaic | null) => void;
  setPluginSpecs: (specs: PluginView[]) => void;
  setLiveMode: (id: string) => void;
  setModeSelValue: (id: string) => void;
  refreshModeOptions: () => void;
  reattachModeSelect: () => void;
};

let bindings: ApplyModeTestBindings | null = null;

export function registerApplyModeTestBindings(b: ApplyModeTestBindings): void {
  bindings = b;
}

export function resetApplyModeTestOverrides(): void {
  if (!bindings) return;
  bindings.setEnsureReviewedOverride(null);
  bindings.setReviewOverride(null);
  applyPluginCatalog([]);
}

export function configureApplyModeForTests(cfg: ApplyModeTestConfig): void {
  if (!bindings) throw new Error("apply-mode test bindings not registered");
  bindings.reattachModeSelect();
  bindings.setEnsureReviewedOverride(cfg.ensureReviewed ?? null);
  bindings.setReviewOverride(cfg.review ?? null);
  if (cfg.mosaic !== undefined) bindings.setMosaic(cfg.mosaic);
  if (cfg.pluginSpecs) {
    bindings.setPluginSpecs(cfg.pluginSpecs);
    applyPluginCatalog(cfg.pluginSpecs);
    bindings.refreshModeOptions();
  }
  if (cfg.liveMode != null) {
    bindings.setLiveMode(cfg.liveMode);
    bindings.setModeSelValue(cfg.liveMode);
  }
  if (cfg.lastConsentedMode != null) setLastConsentedModeId(cfg.lastConsentedMode);
}

/** Re-fetch the plugin catalog as the consent poll / live patch would (installPlugins + resume). */
export async function refreshCatalogForTests(): Promise<void> {
  if (!bindings) throw new Error("apply-mode test bindings not registered");
  await bindings.refreshCatalog();
}
