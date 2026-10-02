/**
 * #261: arcade knob reads go through the scope resolver.
 * A stored value sits on the arcade view. The caller's fallback is the built-in.
 * Missing storage still returns the fallback, same as `localStorage.getItem(key) ?? fallback`.
 */
import { emptyScopeStore, resolve } from "./settings-scope";

export function readArcadeKnob(storageKey: string, fallback: string): string {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    return fallback;
  }
  const m = /^zoto-viz\.([a-z0-9-]+)\.(.+)$/.exec(storageKey);
  if (!m) return raw ?? fallback;
  const family = m[1]!;
  const field = m[2]!;
  const store = emptyScopeStore();
  if (raw !== null) store.view[family] = { [field]: raw };
  store.builtin[field] = fallback;
  const got = resolve(store, field, {
    packId: family,
    viewId: family,
    wallId: "default",
    tileId: family,
  });
  return got == null ? fallback : String(got);
}
