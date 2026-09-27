import type { ServerOptions } from "vite";

/** SwiftShader readback harnesses share one middleware-mode Vite; HMR must stay off (port 24678 clashes). */
export function packMirrorReadbackViteServerOptions(): ServerOptions {
  return { middlewareMode: true, hmr: false };
}
