/** Capped layout device-pixel ratio (max 1.5). Mint module: only place under `web/src` that reads `window.devicePixelRatio`. */
export type DevicePxRatio = number & { readonly __brand: "devicePxRatio" };

export const DEFAULT_MAX_DEVICE_PX_RATIO = 1.5;

/** @deprecated use {@link DEFAULT_MAX_DEVICE_PX_RATIO} */
export const MAX_DEVICE_PX_RATIO = DEFAULT_MAX_DEVICE_PX_RATIO;

let layoutMaxDevicePxRatio = DEFAULT_MAX_DEVICE_PX_RATIO;

/** Set by `RenderHost` construction; shared by stage3d, feed, and host layout. */
export function configureLayoutMaxDevicePxRatio(max: number): void {
  layoutMaxDevicePxRatio = max;
}

export function layoutMaxDevicePxRatioCap(): number {
  return layoutMaxDevicePxRatio;
}

/** Layout DPR getter shared with `RenderHost.devicePxRatio` (window read + cap). */
export function layoutDevicePxRatio(): DevicePxRatio {
  return devicePxRatioFromWindow();
}

export function devicePxRatioFromWindow(): DevicePxRatio {
  const raw =
    typeof window !== "undefined" &&
    typeof window.devicePixelRatio === "number" &&
    Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1;
  return Math.min(raw, layoutMaxDevicePxRatio) as DevicePxRatio;
}

export function devicePxRatioFromNumber(n: number): DevicePxRatio {
  return Math.min(Math.max(n, 0.01), layoutMaxDevicePxRatio) as DevicePxRatio;
}

export function devicePxRatioNumber(r: DevicePxRatio): number {
  return r;
}

/** CSS layout pixels → backing-store device pixels at the current layout DPR. */
export function layoutBackingDevicePx(cssPx: number): number {
  return Math.round(cssPx * devicePxRatioNumber(layoutDevicePxRatio()));
}
