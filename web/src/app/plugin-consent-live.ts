import type { PluginView } from "../plugins/plugin";
import { noteConsentGranted } from "./consent-store";

const CONSENT_ONLY_KEYS = new Set(["pluginConsent", "reloadPlugins"]);

/**
 * True when a live patch carries only consent / catalog news. Such a patch updates the catalog
 * rows (and pane status) and stops there: it must never fall through to `applySettings`, which
 * re-applies the whole mode and replaces the pack's frame (QE K4b), or rewrite the AI profile.
 */
export function livePatchIsConsentOnly(patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((k) => CONSENT_ONLY_KEYS.has(k));
}

/** Apply a monitor live `pluginConsent` bump onto in-memory catalog rows. */
export function mergePluginConsentLivePatch(
  specs: PluginView[],
  patch: Record<string, unknown>,
): boolean {
  const raw = patch.pluginConsent;
  if (!raw || typeof raw !== "object") return false;
  const id = String((raw as { id?: unknown }).id ?? "").trim();
  const kind = (raw as { kind?: unknown }).kind;
  if (!id || (kind !== "reviewed" && kind !== "authored")) return false;
  const spec = specs.find((p) => p.id === id);
  if (!spec) return false;
  spec.consent = kind;
  noteConsentGranted(spec, kind);
  if (spec.has_sky_shader || spec.shader_sha256) spec.sky_available = true;
  return true;
}
