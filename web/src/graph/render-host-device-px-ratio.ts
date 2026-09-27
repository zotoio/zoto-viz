/** Capped layout device-pixel ratio (max 1.5). Mint module: only place under `web/src` that reads `window.devicePixelRatio`. */
export type DevicePxRatio = number & { readonly __brand: "devicePxRatio" };

export const DEFAULT_MAX_DEVICE_PX_RATIO = 1.5;

let layoutMaxDevicePxRatio = DEFAULT_MAX_DEVICE_PX_RATIO;

/** Set by `RenderHost` construction; shared by stage3d, feed, and host layout. */
export function configureLayoutMaxDevicePxRatio(max: number): void {
  layoutMaxDevicePxRatio = max;
  if (!watchPinned) {
    cachedLayoutRatio = capRawDevicePxRatio(readWindowDevicePixelRatio());
  }
}

let cachedLayoutRatio = capRawDevicePxRatio(1);
let watchInstalled = false;
let watchPinned = false;
let currentMq: MediaQueryList | null = null;
let onDpiChange: (() => void) | null = null;
const layoutChangeListeners = new Set<(ratio: DevicePxRatio) => void>();

function capRawDevicePxRatio(raw: number): DevicePxRatio {
  const n = typeof raw === "number" ? raw : 1;
  return Math.min(n, layoutMaxDevicePxRatio) as DevicePxRatio;
}

function readWindowDevicePixelRatio(): number {
  if (typeof window === "undefined") return 1;
  const raw = window.devicePixelRatio;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 1;
}

function notifyLayoutListeners(ratio: DevicePxRatio): void {
  for (const fn of layoutChangeListeners) fn(ratio);
}

function rearmResolutionMediaQuery(rawDppx: number): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  if (currentMq && onDpiChange) currentMq.removeEventListener("change", onDpiChange);
  currentMq = window.matchMedia(`(resolution: ${rawDppx}dppx)`);
  onDpiChange = () => {
    const raw = readWindowDevicePixelRatio();
    const prev = cachedLayoutRatio;
    const next = capRawDevicePxRatio(raw);
    cachedLayoutRatio = next;
    rearmResolutionMediaQuery(raw);
    if (next !== prev) notifyLayoutListeners(next);
  };
  currentMq.addEventListener("change", onDpiChange);
}

/** Pin cached layout DPR (fixed `RenderHost` `dpr` option); disables window watch reads. */
export function pinLayoutDevicePxRatio(ratio: DevicePxRatio): void {
  watchPinned = true;
  cachedLayoutRatio = ratio;
  if (currentMq && onDpiChange) currentMq.removeEventListener("change", onDpiChange);
  currentMq = null;
  onDpiChange = null;
}

export function resetLayoutDevicePxRatioWatch(): void {
  watchPinned = false;
  watchInstalled = false;
  layoutChangeListeners.clear();
  if (currentMq && onDpiChange) currentMq.removeEventListener("change", onDpiChange);
  currentMq = null;
  onDpiChange = null;
  cachedLayoutRatio = capRawDevicePxRatio(1);
}

/** Start window DPR watch: one read now, then reads only in the `matchMedia` change handler. */
export function startLayoutDevicePxRatioWatch(): void {
  if (watchPinned) return;
  const raw = readWindowDevicePixelRatio();
  cachedLayoutRatio = capRawDevicePxRatio(raw);
  if (watchInstalled) return;
  watchInstalled = true;
  rearmResolutionMediaQuery(raw);
}

export function onLayoutDevicePxRatioChange(fn: (ratio: DevicePxRatio) => void): () => void {
  layoutChangeListeners.add(fn);
  return () => layoutChangeListeners.delete(fn);
}

/**
 * Cached capped layout DPR. Hot path: no `window.devicePixelRatio` read.
 * Steady-frame integration (host + stage3d + feed): **2 getter calls per frame** (stage3d + feed).
 */
export function layoutDevicePxRatio(): DevicePxRatio {
  if (!watchInstalled && !watchPinned) startLayoutDevicePxRatioWatch();
  return cachedLayoutRatio;
}

export function devicePxRatioFromNumber(n: number): DevicePxRatio {
  return capRawDevicePxRatio(Math.max(n, 0.01));
}

export function devicePxRatioNumber(r: DevicePxRatio): number {
  return r;
}

/** CSS layout pixels → backing-store device pixels at the current layout DPR. */
export function layoutBackingDevicePx(cssPx: number): number {
  return Math.round(cssPx * devicePxRatioNumber(layoutDevicePxRatio()));
}
