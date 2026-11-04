/**
 * Client half of the /ws delta protocol (see service/state_delta.py).
 *  {"$r": v}                        replace
 *  {"$o": {k: patch}, "$d": [keys]} object patch
 *  {"$a": len, "$i": {idx: patch}}  array patch
 *  null                             unchanged
 */
export type Patch =
  | null
  | { $r: unknown }
  | { $o: Record<string, Patch>; $d?: string[] }
  | { $a: number; $i: Record<string, Patch> };

/**
 * Copy-on-write: containers on a changed path are new objects, untouched subtrees keep their
 * identity, and `base` itself is never mutated (consumers may hold the previous frame).
 */
export function applyPatch(base: unknown, patch: Patch): unknown {
  if (patch === null || patch === undefined) return base;
  if ("$r" in patch) return patch.$r;
  if ("$o" in patch) {
    const src = (base && typeof base === "object" && !Array.isArray(base) ? base : {}) as Record<string, unknown>;
    const obj: Record<string, unknown> = { ...src };
    for (const k of patch.$d ?? []) delete obj[k];
    for (const [k, p] of Object.entries(patch.$o)) obj[k] = applyPatch(src[k], p);
    return obj;
  }
  if ("$a" in patch) {
    const arr = (Array.isArray(base) ? base.slice(0, patch.$a) : []) as unknown[];
    while (arr.length < patch.$a) arr.push(null);
    for (const [i, p] of Object.entries(patch.$i)) arr[Number(i)] = applyPatch(arr[Number(i)], p);
    return arr;
  }
  return base;
}
