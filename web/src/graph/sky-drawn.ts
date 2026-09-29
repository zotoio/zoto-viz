/**
 * "First frame drawn with this plugin sky", for the Starting card and the sky deadline.
 *
 * `arm(true)` on every sky install, `arm(false)` on a clear. `frame()` runs after the tile's render
 * call returns: when armed it reads the installed sky id, and on the first frame the sky is on it
 * fires listeners and disarms. Disarmed, a frame costs one boolean test. Nothing here touches the GPU (no finish, readPixels or fences):
 * the render call returning is the signal, since any first-use program compile happens inside it.
 */
export class SkyDrawnSignal {
  private armed = false;
  private drawnId: string | null = null;
  private readonly listeners = new Set<(id: string) => void>();
  /** Sky-id reads made by frame(), for the count rows. */
  checks = 0;

  constructor(private readonly currentSky: () => string | null) {}

  arm(expectSky: boolean): void {
    this.armed = expectSky;
    this.drawnId = null;
  }

  frame(): void {
    if (!this.armed) return;
    this.checks++;
    const id = this.currentSky();
    // Installed but not yet the tile's material (backdrop not on "plugin" yet): stay armed.
    if (!id) return;
    this.armed = false;
    this.drawnId = id;
    for (const cb of [...this.listeners]) cb(id);
  }

  /** The drawn sky, if it is still the installed one. */
  drawn(current: string | null): string | null {
    return current && current === this.drawnId ? current : null;
  }

  on(cb: (id: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
