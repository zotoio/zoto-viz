/** Coalesce sandbox setConfig to once per frame per pack; skip identical payloads. */
export class SandboxConfigBatcher {
  private pending = new Map<string, Record<string, string>>();
  private scheduled = false;
  private rafId = 0;
  private lastJson = new Map<string, string>();

  constructor(
    private readonly onPost: (packId: string, config: Record<string, string>) => void,
    private readonly scheduleFrame: (cb: () => void) => number,
    private readonly cancelFrame: (id: number) => void,
  ) {}

  schedule(packId: string, config: Record<string, string>): void {
    const json = JSON.stringify(config);
    if (this.lastJson.get(packId) === json) {
      this.pending.delete(packId);
      if (this.pending.size === 0 && this.scheduled) {
        this.cancelFrame(this.rafId);
        this.scheduled = false;
      }
      return;
    }
    this.pending.set(packId, config);
    if (this.scheduled) return;
    this.scheduled = true;
    this.rafId = this.scheduleFrame(() => {
      this.scheduled = false;
      const batch = new Map(this.pending);
      this.pending.clear();
      for (const [id, cfg] of batch) {
        const nextJson = JSON.stringify(cfg);
        this.lastJson.set(id, nextJson);
        this.onPost(id, cfg);
      }
    });
  }

  cancel(): void {
    this.pending.clear();
    if (this.scheduled) {
      this.cancelFrame(this.rafId);
      this.scheduled = false;
    }
  }

  reset(): void {
    this.cancel();
    this.lastJson.clear();
  }
}
