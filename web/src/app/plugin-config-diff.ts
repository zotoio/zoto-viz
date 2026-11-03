const PREFIX = "zoto-viz.plugin.";

/** Every plugin knob currently in localStorage (`zoto-viz.plugin.<store>.<key>` → value). */
export function pluginConfigSnapshot(storage: Pick<Storage, "length" | "key" | "getItem"> = localStorage): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(PREFIX)) out.set(k, storage.getItem(k) ?? "");
  }
  return out;
}

/** Config store ids whose knobs differ between two snapshots (added, removed or changed). */
export function changedPluginStores(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const stores = new Set<string>();
  const note = (k: string) => {
    const rest = k.slice(PREFIX.length);
    const dot = rest.lastIndexOf(".");
    if (dot > 0) stores.add(rest.slice(0, dot));
  };
  for (const [k, v] of after) if (before.get(k) !== v) note(k);
  for (const k of before.keys()) if (!after.has(k)) note(k);
  return [...stores];
}
