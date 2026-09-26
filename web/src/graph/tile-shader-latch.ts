/** Per-tile latch after a failed plugin sky compile (Three.js path). */

import type { ContextGen } from "./context-gen.mint";

export class TileShaderLatch {
  private failed = false;
  private compiled = false;
  private compiledGen: ContextGen | null = null;

  get dead(): boolean {
    return this.failed;
  }

  reset(): void {
    this.failed = false;
    this.compiled = false;
    this.compiledGen = null;
  }

  /** Already compiled successfully for this context generation. */
  isFresh(gen: ContextGen): boolean {
    return this.compiled && this.compiledGen === gen && !this.failed;
  }

  markCompiled(gen: ContextGen): void {
    if (this.failed) return;
    this.compiled = true;
    this.compiledGen = gen;
  }

  fail(msg: string, log: (m: string) => void): void {
    if (this.failed) return;
    this.failed = true;
    log(msg);
  }
}
