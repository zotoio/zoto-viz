import type { ProfileSettings } from "../core/profiles";
import { mergeAgentPatch, pickAgentSettings, stripMosaicLayout } from "../ui/capture";
import { livePatchIsConsentOnly } from "./plugin-consent-live";

/** Everything `applyAgentPatch` touches in the page, injected so the flow is testable. */
export interface AgentPatchHost {
  reloadClient(): void;
  refreshPluginCatalogAndResume(): Promise<void>;
  /** Merges a live consent patch into the catalog; true when something changed. */
  mergeConsentPatch(patch: Record<string, unknown>): boolean;
  hasConsentPending(): boolean;
  resumeMosaicConsentPending(): Promise<void>;
  modeIds(): string[];
  diceOn(): boolean;
  collectSettings(): ProfileSettings;
  applySettings(s: ProfileSettings, flags?: { keepLayout?: boolean }): void;
  rollDice(): Promise<void>;
  syncTemper(t: { temper?: number; weather?: unknown }): void;
  aiMosaicLayoutOn(): boolean;
  /** Mosaic tile ids and focused tile, or null when the mosaic is off. */
  mosaicTiles(): { tileIds: string[]; focusedId: string } | null;
  writeAi(s: ProfileSettings): Promise<void>;
}

export function createApplyAgentPatch(host: AgentPatchHost): (patch: Record<string, unknown>) => Promise<void> {
  return async (patch) => {
    if (patch.reloadClient === true) {
      host.reloadClient();
      return;
    }
    if (patch.reloadPlugins === true) {
      await host.refreshPluginCatalogAndResume();
    } else if (host.mergeConsentPatch(patch) && host.hasConsentPending()) {
      await host.resumeMosaicConsentPending();
    }
    // Consent news never re-applies the mode (that replaced Koi's frame on every auto-consent).
    if (livePatchIsConsentOnly(patch)) return;
    const p = pickAgentSettings(patch, host.modeIds());
    if (p.dice) {
      const wasOn = host.diceOn();
      host.applySettings(mergeAgentPatch(host.collectSettings(), { dice: p.dice }));
      if (p.dice.on === true && !wasOn && !p.shuffle) await host.rollDice();
    }
    if (p.shuffle) {
      await host.rollDice();
      return;
    }
    if (p.temper != null || p.weather) host.syncTemper({ temper: p.temper, weather: p.weather });
    const lockLayout = !host.aiMosaicLayoutOn();
    if (lockLayout && p.anim) p.anim = stripMosaicLayout(p.anim);
    const cur = host.collectSettings();
    const wall = host.mosaicTiles();
    if (lockLayout && wall && p.mode && !wall.tileIds.includes(p.mode)) {
      const tiles = [...wall.tileIds];
      const at = Math.max(0, tiles.indexOf(wall.focusedId));
      tiles[at] = p.mode;
      p.anim = { ...p.anim, mosaicTiles: tiles };
    }
    host.applySettings(mergeAgentPatch(cur, p), { keepLayout: lockLayout });
    await host.writeAi(host.collectSettings());
  };
}
