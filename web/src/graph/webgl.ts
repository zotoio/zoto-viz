/** True when this document can create a usable WebGL (2) context. */

export function probeWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2", { failIfMajorPerformanceCaveat: false })
      || c.getContext("webgl", { failIfMajorPerformanceCaveat: false })
      || c.getContext("experimental-webgl", { failIfMajorPerformanceCaveat: false });
    if (!gl || !("getParameter" in gl)) return false;
    const ctx = gl as WebGLRenderingContext;
    const vendor = String(ctx.getParameter(ctx.VENDOR) ?? "");
    const renderer = String(ctx.getParameter(ctx.RENDERER) ?? "");
    // Chromium / Electron Simple Browser: GPU process disabled (VENDOR 0xffff).
    if (/^disabled$/i.test(vendor) || /^disabled$/i.test(renderer)) return false;
    return true;
  } catch {
    return false;
  }
}
