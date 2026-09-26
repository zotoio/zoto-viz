import type { PluginView } from "../plugins/plugin";
import { grantPluginConsent } from "../plugins/plugin";
import { askPluginReview } from "../plugins/plugin-ui";
import { pluginNeedsReview } from "../plugins/plugin";
import { autoconsentEligible, autoconsentEnabled, autoconsentKind } from "../plugins/consent";

const session = new Map<string, Promise<boolean>>();

export function resetPackConsentSession(): void {
  session.clear();
}

/** Once per pack per browser session — server grant is authoritative; no localStorage hash bypass. */
export function ensurePackReviewed(spec: PluginView | null): Promise<boolean> {
  if (!spec || !pluginNeedsReview(spec)) return Promise.resolve(true);
  if (spec.consent) return Promise.resolve(true);
  const pending = session.get(spec.id);
  if (pending) return pending;
  const p = (async () => {
    if (autoconsentEnabled() && autoconsentEligible(spec)) {
      const kind = autoconsentKind(spec);
      try {
        await grantPluginConsent(spec.id, kind);
        spec.consent = kind;
        if (spec.has_sky_shader || spec.shader_sha256) spec.sky_available = true;
        return true;
      } catch (e) {
        console.warn("zoto-viz plugin autoconsent:", e);
        return false;
      }
    }
    const kind = await askPluginReview(spec);
    if (!kind) return false;
    try {
      await grantPluginConsent(spec.id, kind);
      spec.consent = kind;
      if (spec.has_sky_shader || spec.shader_sha256) spec.sky_available = true;
      return true;
    } catch (e) {
      console.warn("zoto-viz plugin consent:", e);
      return false;
    }
  })();
  session.set(spec.id, p);
  return p;
}
