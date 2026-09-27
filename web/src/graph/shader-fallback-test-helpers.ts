import * as THREE from "three";
import { vi } from "vitest";
import type { RenderHost } from "./render-host";

/** Drive Three.js compile failure through the real onShaderError hook. */
export function failCompileWith(
  host: RenderHost,
  tileId: string,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: { shaderLog?: string; programLog?: string; log?: (m: string) => void },
): { compile: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> } {
  const rd = host.renderer as THREE.WebGLRenderer;
  const shaderLog = opts.shaderLog ?? "";
  const programLog = opts.programLog ?? "";
  const gl = {
    getShaderInfoLog: () => shaderLog,
    getProgramInfoLog: () => programLog,
  } as unknown as WebGL2RenderingContext;
  const logFn = opts.log ?? vi.fn();
  const compile = vi.fn(() => {
    rd.debug!.onShaderError!(gl, {} as never, {} as never, {} as never);
  });
  rd.compile = compile as unknown as typeof rd.compile;
  host.compilePluginSky(tileId, scene, camera, logFn);
  return { compile, log: logFn as ReturnType<typeof vi.fn> };
}

/** Count DOM textContent assignments on one element. */
export function trackTextWrites(el: HTMLElement): { readonly writes: number } {
  const d = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
  let writes = 0;
  Object.defineProperty(el, "textContent", {
    configurable: true,
    get() {
      return d.get!.call(this);
    },
    set(v) {
      writes++;
      d.set!.call(this, v);
    },
  });
  return {
    get writes() {
      return writes;
    },
  };
}

export const FALLBACK_GRACE_FRAMES = 30;
