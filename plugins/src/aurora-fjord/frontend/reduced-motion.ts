/** reducedMotion "auto" follows the system prefers-reduced-motion setting, live. */

import type { ReducedMotion } from "./config";

type MotionListener = (e: { matches: boolean }) => void;

interface MotionQuery {
  matches: boolean;
  addEventListener?: (type: "change", fn: MotionListener) => void;
  removeEventListener?: (type: "change", fn: MotionListener) => void;
  addListener?: (fn: MotionListener) => void;
  removeListener?: (fn: MotionListener) => void;
}

const QUERY = "(prefers-reduced-motion: reduce)";

let query: MotionQuery | null = null;
let systemReduce = false;
const onChange: MotionListener = (e) => { systemReduce = !!e.matches; };

/** Starts following the system setting; a sandbox without matchMedia reads as no preference. */
export function watchSystemReducedMotion(): void {
  if (query) return;
  const mm = (globalThis as { matchMedia?: (q: string) => MotionQuery }).matchMedia;
  if (typeof mm !== "function") return;
  try {
    // matchMedia throws "Illegal invocation" when called unbound
    query = mm.call(globalThis, QUERY) ?? null;
  } catch {
    query = null;
  }
  if (!query) return;
  systemReduce = !!query.matches;
  if (query.addEventListener) query.addEventListener("change", onChange);
  else query.addListener?.(onChange);
}

export function unwatchSystemReducedMotion(): void {
  if (query) {
    if (query.removeEventListener) query.removeEventListener("change", onChange);
    else query.removeListener?.(onChange);
  }
  query = null;
  systemReduce = false;
}

export function resolveReducedMotion(mode: ReducedMotion, system = systemReduce): boolean {
  return mode === "auto" ? system : mode === "on";
}
