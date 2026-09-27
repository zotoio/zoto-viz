import type { PluginView } from "../plugins/plugin";

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
  if (spec.has_sky_shader || spec.shader_sha256) spec.sky_available = true;
  return true;
}
