/** True when the user asked the OS to minimize non-essential motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

let motionMq: MediaQueryList | null = null;
const motionListeners = new Set<() => void>();

function notifyReducedMotionChange(): void {
  for (const cb of motionListeners) cb();
}

/** React when the user toggles prefers-reduced-motion (including video sky playback). */
/** @internal Reset global listener state between vitest cases. */
export function resetReducedMotionSubscriptionForTests(): void {
  if (motionMq) {
    motionMq.removeEventListener("change", notifyReducedMotionChange);
    motionMq = null;
  }
  motionListeners.clear();
}

export function subscribeReducedMotion(onChange: () => void): () => void {
  motionListeners.add(onChange);
  if (typeof matchMedia === "function" && !motionMq) {
    motionMq = matchMedia("(prefers-reduced-motion: reduce)");
    motionMq.addEventListener("change", notifyReducedMotionChange);
  }
  return () => {
    motionListeners.delete(onChange);
    if (motionListeners.size === 0 && motionMq) {
      motionMq.removeEventListener("change", notifyReducedMotionChange);
      motionMq = null;
    }
  };
}
