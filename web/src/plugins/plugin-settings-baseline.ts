import type { PluginView } from "./plugin";

export function instanceDefaultValue(
  spec: PluginView,
  key: string,
): string | undefined {
  const defs = spec.instanceDefaults;
  if (defs && defs[key] !== undefined) return String(defs[key]);
  const inst = spec.instances?.find((i) => i.id === (spec.instanceId ?? spec.id));
  const row = inst?.defaults;
  if (!row || row[key] === undefined) return undefined;
  return String(row[key]);
}
