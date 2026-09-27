/** Per-tile latch after a failed plugin sky compile (Three.js path). */

export class TileShaderLatch {
  private failed = false;
  private compiled = false;

  get dead(): boolean {
    return this.failed;
  }

  reset(): void {
    this.failed = false;
    this.compiled = false;
  }

  /** Already compiled successfully for this context generation. */
  isFresh(): boolean {
    return this.compiled && !this.failed;
  }

  markCompiled(): void {
    if (this.failed) return;
    this.compiled = true;
  }

  fail(msg: string, log: (m: string) => void): void {
    if (this.failed) return;
    this.failed = true;
    log(msg);
  }
}
