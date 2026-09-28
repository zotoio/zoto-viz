import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let shared: ViteDevServer | undefined;
let starting: Promise<ViteDevServer> | undefined;
let holders = 0;

/** One middleware-mode Vite instance for all SwiftShader readback tests (avoids HMR port clashes). */
export async function acquirePackMirrorReadbackVite(): Promise<ViteDevServer> {
  holders += 1;
  if (shared) return shared;
  if (!starting) {
    starting = createServer({
      configFile: path.join(webRoot, "vite.config.mjs"),
      server: { middlewareMode: true, hmr: false, watch: null },
    }).then((vite) => {
      shared = vite;
      return vite;
    });
  }
  return starting;
}

/** Vitest may finish one readback file while another is still running; do not tear down mid-run. */
export async function releasePackMirrorReadbackVite(): Promise<void> {
  holders = Math.max(0, holders - 1);
}
