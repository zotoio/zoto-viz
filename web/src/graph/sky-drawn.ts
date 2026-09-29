/**
 * "First frame with this plugin sky has been presented", for the Starting card and the sky deadline.
 *
 * `arm(true)` on every sky install, `arm(false)` on a clear. `frame()` runs after the tile's render
 * call returns. While armed it reads the installed sky id; on the first frame the sky is the tile's
 * material it disarms and schedules ONE `requestAnimationFrame` callback. Listeners fire from that
 * callback, not from the draw: the draw call only queues work (a first-use program compile can
 * block later, at flush or present), and the next animation frame cannot start until the frame
 * that drew the sky has been presented. Disarmed, a frame costs one boolean test.
 *
 * Nothing here touches the GPU: no finish, readPixels, fences or sync polls.
 */
export type FrameScheduler = (cb: () => void) => void;

const nextAnimationFrame: FrameScheduler = (cb) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => cb());
  else setTimeout(cb, 16);
};

export class SkyDrawnSignal {
  private armed = false;
  private drawnId: string | null = null;
  /** Bumped on every arm, so a presentation callback from an older install does nothing. */
  private gen = 0;
  private readonly listeners = new Set<(id: string) => void>();
  /** Sky-id reads made by frame(), for the count rows. */
  checks = 0;
  /** Presentation callbacks scheduled, for the count rows (one per install). */
  scheduled = 0;

  constructor(
    private readonly currentSky: () => string | null,
    private readonly schedule: FrameScheduler = nextAnimationFrame,
  ) {}

  arm(expectSky: boolean): void {
    this.gen++;
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
    const gen = this.gen;
    this.scheduled++;
    this.schedule(() => this.presented(gen, id));
  }

  private presented(gen: number, id: string): void {
    if (gen !== this.gen) return; // reinstalled or cleared since the draw
    if (this.currentSky() !== id) {
      this.armed = true; // backdrop moved off the sky before it was shown: wait for the next draw
      return;
    }
    this.drawnId = id;
    for (const cb of [...this.listeners]) cb(id);
  }

  /** The presented sky, if it is still the installed one. */
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
