/** Drop a one-shot context now. Chrome holds it until loseContext or GC and caps how many can exist. */
export function releaseThrowawayGl(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): void {
  if (!gl) return;
  try {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* context already dead */
  }
}

/** Tear down a dedicated WebGLRenderer (solo pane, not the shared {@link RenderHost}). */
export function disposeOwnedWebGLRenderer(renderer: {
  getContext(): WebGLRenderingContext | WebGL2RenderingContext | null;
  forceContextLoss(): void;
  dispose(): void;
  domElement: HTMLCanvasElement;
}): void {
  releaseThrowawayGl(renderer.getContext());
  try {
    renderer.forceContextLoss();
  } catch {
    /* already lost */
  }
  renderer.dispose();
  renderer.domElement.remove();
}

/** True when this document can create a usable WebGL (2) context. */
export function probeWebGL(): boolean {
  if (typeof document === "undefined") return false;
  let gl: WebGLRenderingContext | null = null;
  try {
    const c = document.createElement("canvas");
    gl = (c.getContext("webgl2", { failIfMajorPerformanceCaveat: false })
      || c.getContext("webgl", { failIfMajorPerformanceCaveat: false })
      || c.getContext("experimental-webgl", { failIfMajorPerformanceCaveat: false })) as WebGLRenderingContext | null;
    if (!gl || !("getParameter" in gl)) return false;
    const vendor = String(gl.getParameter(gl.VENDOR) ?? "");
    const renderer = String(gl.getParameter(gl.RENDERER) ?? "");
    // Chromium / Electron Simple Browser: GPU process disabled (VENDOR 0xffff).
    if (/^disabled$/i.test(vendor) || /^disabled$/i.test(renderer)) return false;
    return true;
  } catch {
    return false;
  } finally {
    releaseThrowawayGl(gl);
  }
}
