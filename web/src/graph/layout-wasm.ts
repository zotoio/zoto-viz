/**
 * WebAssembly force kernel (assembly/layout.ts → layout.wasm).
 *
 * `bindKernel` wraps an instantiated module; `loadWasmKernel` fetches and instantiates it through
 * Vite's `?init` import and returns null when the module is missing or the runtime cannot run it,
 * in which case the layout keeps its JavaScript forces.
 */

import type { ForceKernel, KernelBuffers } from "./layout-kernels";

export interface LayoutWasmExports {
  memory: WebAssembly.Memory;
  ensure(n: number): number;
  growPool(want: number): number;
  posPtr(): number;
  strPtr(): number;
  outPtr(): number;
  rolePtr(): number;
  magPtr(): number;
  magLen(): number;
  manyBody(n: number, alpha: number, theta2: number, distMin2: number, distMax2: number): number;
  magnet(n: number, alpha: number, cross: number, maxD2: number, pulse: number): void;
  clearOut(n: number): void;
}

/** Imports the AssemblyScript module expects. */
export function wasmImports(): WebAssembly.Imports {
  return {
    env: {
      abort: (_msg: number, _file: number, line: number, col: number) => {
        throw new Error(`layout.wasm abort at ${line}:${col}`);
      },
    },
  };
}

/** Wrap a module instance as a `ForceKernel`. Buffer views are rebuilt whenever memory may have moved. */
export function bindKernel(ex: LayoutWasmExports): ForceKernel {
  let bufs: KernelBuffers | null = null;
  let cap = 0;
  let mem: ArrayBuffer | null = null;
  const views = (): KernelBuffers => {
    const buffer = ex.memory.buffer;
    if (bufs && mem === buffer) return bufs;
    mem = buffer;
    bufs = {
      pos: new Float32Array(buffer, ex.posPtr(), cap * 3),
      str: new Float32Array(buffer, ex.strPtr(), cap),
      role: new Int32Array(buffer, ex.rolePtr(), cap),
      mag: new Float32Array(buffer, ex.magPtr(), ex.magLen()),
      out: new Float32Array(buffer, ex.outPtr(), cap * 3),
    };
    return bufs;
  };
  return {
    reserve(n) {
      cap = ex.ensure(n);
      mem = null; // pointers may have changed
      return cap;
    },
    buffers: views,
    manyBody(n, alpha, theta2, distMin2, distMax2) {
      let r = ex.manyBody(n, alpha, theta2, distMin2, distMax2);
      // a deep split of near-coincident points can exhaust the tree pool: grow once and retry
      if (r === -1) {
        ex.growPool(n * 16 + 1024);
        r = ex.manyBody(n, alpha, theta2, distMin2, distMax2);
      }
      return r === 0;
    },
    magnet(n, alpha, cross, maxD2, pulse) {
      ex.magnet(n, alpha, cross, maxD2, pulse);
    },
  };
}

/** Instantiate the module from raw bytes (tests, Node). */
export async function kernelFromBytes(bytes: BufferSource): Promise<ForceKernel> {
  const { instance } = await WebAssembly.instantiate(bytes, wasmImports());
  return bindKernel(instance.exports as unknown as LayoutWasmExports);
}

export async function loadWasmKernel(): Promise<ForceKernel | null> {
  if (typeof WebAssembly === "undefined") return null;
  try {
    const init = (await import("./layout.wasm?init")).default;
    const instance = await init(wasmImports());
    const ex = instance.exports as unknown as LayoutWasmExports;
    if (typeof ex.manyBody !== "function" || !(ex.memory instanceof WebAssembly.Memory)) return null;
    return bindKernel(ex);
  } catch {
    return null;
  }
}
