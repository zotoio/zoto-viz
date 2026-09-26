/** Capped layout device-pixel ratio (max 1.5). Mint module: only place that reads `devicePixelRatio` for the shared host. */
export type DevicePxRatio = number & { readonly __brand: "devicePxRatio" };

export const MAX_DEVICE_PX_RATIO = 1.5;

export function devicePxRatioFromWindow(): DevicePxRatio {
  const raw =
    typeof window !== "undefined" &&
    typeof window.devicePixelRatio === "number" &&
    Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1;
  return Math.min(raw, MAX_DEVICE_PX_RATIO) as DevicePxRatio;
}

export function devicePxRatioFromNumber(n: number): DevicePxRatio {
  return Math.min(Math.max(n, 0.01), MAX_DEVICE_PX_RATIO) as DevicePxRatio;
}

export function devicePxRatioNumber(r: DevicePxRatio): number {
  return r;
}
