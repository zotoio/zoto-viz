/** Monotonic ms for viz frame timing (#45 / #52); swap implementation when vizClockMs lands. */
export function vizClockMs(): number {
  return performance.now();
}
