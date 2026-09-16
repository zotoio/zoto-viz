/**
 * Main-thread handle on the force layout. Runs `LayoutSim` in a Worker when the browser has one
 * (the normal case), or inline on the main thread otherwise (tests, very old runtimes).
 *
 * One frame is in flight at a time: `frame()` is a no-op while the previous tick has not answered,
 * so a slow simulation can never queue up behind the render loop — positions simply hold.
 */

import {
  LayoutSim, type FrameMsg, type LayoutIn, type LayoutOut, type LayoutParams, type PositionsMsg, type StructureMsg,
} from "./layout-core";
import { loadWasmKernel } from "./layout-wasm";

export type LayoutBackend = "worker" | "inline";

/**
 * A tick unanswered for this long means the worker is dead or never started (some embedded
 * browsers construct Workers that never run and never raise `error`): tick inline from then on.
 */
export const STALL_MS = 2500;

export interface LayoutClientOpts {
  /** Try to run the inline fallback on the compiled kernel (default true; tests turn it off). */
  wasm?: boolean;
}

export class LayoutClient {
  private worker: Worker | null = null;
  private inline: LayoutSim | null = null;
  private inFlight = false;
  private sentAt = 0;
  private _kernel: "js" | "wasm" = "js";
  private readonly wasm: boolean;

  constructor(private readonly onPositions: (m: PositionsMsg) => void, opts: LayoutClientOpts = {}) {
    this.wasm = opts.wasm ?? true;
    let w: Worker | null = null;
    if (typeof Worker !== "undefined") {
      try {
        w = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module", name: "zoto-layout" });
      } catch {
        w = null;
      }
    }
    if (w) {
      this.worker = w;
      w.onmessage = (ev: MessageEvent<LayoutOut>) => {
        if (this.worker !== w) return;
        const m = ev.data;
        if (m.type === "positions") {
          this.inFlight = false;
          this.onPositions(m);
        } else if (m.type === "kernel") {
          this._kernel = m.kind;
        }
      };
      w.onerror = () => this.fallbackInline();
    } else {
      this.fallbackInline();
    }
  }

  get backend(): LayoutBackend { return this.inline ? "inline" : "worker"; }

  /** Stop using the worker (crashed, silent, or absent) and tick on this thread with the same state. */
  private fallbackInline(): void {
    if (this.inline) return;
    this.worker?.terminate();
    this.worker = null;
    const sim = new LayoutSim();
    if (this.pendingStructure) sim.setStructure(this.pendingStructure);
    if (this.lastParams) sim.setParams(this.lastParams);
    this.inline = sim;
    this.inFlight = false;
    this.armKernel(sim);
  }

  /** Inline sims get the compiled kernel too, once it has loaded (the worker does this itself). */
  private armKernel(sim: LayoutSim): void {
    if (!this.wasm) return;
    void loadWasmKernel().then((k) => {
      if (k && this.inline === sim) sim.useKernel(k);
    });
  }

  /** which many-body kernel the simulation is using right now */
  get kernel(): "js" | "wasm" { return this.inline ? this.inline.kernelKind : this._kernel; }

  /**
   * A tick is still in flight. Callers skip `frame()` while this is true, so the stall check lives
   * here as well: a worker that never answers must not leave the layout frozen behind a busy flag.
   */
  get busy(): boolean {
    this.checkStall();
    return this.inFlight;
  }

  private checkStall(): void {
    if (this.inFlight && !this.inline && performance.now() - this.sentAt > STALL_MS) this.fallbackInline();
  }

  private pendingStructure: StructureMsg | null = null;
  private lastParams: LayoutParams | null = null;

  setStructure(m: StructureMsg): void {
    this.pendingStructure = m;
    if (this.inline) { this.inline.setStructure(m); return; }
    // copies (not transfers) so the scene may keep the arrays for the inline fallback
    this.post(m);
  }

  setParams(p: LayoutParams): void {
    this.lastParams = p;
    if (this.inline) { this.inline.setParams(p); return; }
    this.post({ type: "params", params: p });
  }

  /** Tick once. Returns false when a tick is still in flight (worker mode) and this frame was skipped. */
  frame(f: FrameMsg): boolean {
    this.checkStall();
    if (this.inline) {
      this.onPositions(this.inline.frame(f));
      return true;
    }
    if (this.inFlight) return false;
    this.inFlight = true;
    this.sentAt = performance.now();
    const transfer: Transferable[] = [];
    if (f.recycle) transfer.push(f.recycle.buffer);
    this.post(f, transfer);
    return true;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.inline = null;
  }

  private post(m: LayoutIn, transfer?: Transferable[]): void {
    this.worker?.postMessage(m, transfer ?? []);
  }
}
