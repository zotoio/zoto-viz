/**
 * Held-open microphone for watchword listening. Callers pass a stream from
 * `askUserMedia` — this class never opens the OS microphone itself.
 */

export class WakeStream {
  private stream: MediaStream | null = null;

  get live(): boolean {
    return this.stream?.getAudioTracks().some((t) => t.readyState === "live") ?? false;
  }

  async enable(existing?: MediaStream): Promise<boolean> {
    if (this.live) {
      if (existing && existing !== this.stream) {
        for (const t of existing.getTracks()) t.stop();
      }
      return true;
    }
    if (existing?.getAudioTracks().some((t) => t.readyState === "live")) {
      this.release();
      this.stream = existing;
      return true;
    }
    if (existing) {
      for (const t of existing.getTracks()) t.stop();
    }
    return false;
  }

  disable(): void {
    this.release();
  }

  private release(): void {
    if (!this.stream) return;
    for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
  }
}
