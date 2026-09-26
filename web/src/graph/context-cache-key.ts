import type { ContextGen } from "./context-gen.mint";

/** Write-on-change caches must include the host context generation. */
export type ContextCacheKey<T extends string | number> = Readonly<{
  gen: ContextGen;
  value: T;
}>;

export function contextCacheKey<T extends string | number>(
  gen: ContextGen,
  value: T,
): ContextCacheKey<T> {
  return { gen, value };
}

export function contextCacheHit<T extends string | number>(
  prev: ContextCacheKey<T> | null,
  next: ContextCacheKey<T>,
): boolean {
  return prev !== null && prev.gen === next.gen && prev.value === next.value;
}
