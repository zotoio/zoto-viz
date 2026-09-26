/** Coalesce sandbox setConfig to once per frame; skip identical payloads. */
export class SandboxConfigBatcher {
  private pending: { packId: string; config: Record<string, string> } | null = null;
  private scheduled = false;
  private rafId = 0;
  private lastJson = "";
  private lastPackId = "";

  constructor(
    private readonly onPost: (packId: string, config: Record<string, string>) => void,
    private readonly scheduleFrame: (cb: () => void) => number,
    private readonly cancelFrame: (id: number) => void,
  ) {}

  schedule(packId: string, config: Record<string, string>): void {
    const json = JSON.stringify(config);
    if (packId === this.lastPackId && json === this.lastJson) return;
    this.pending = { packId, config };
    if (this.scheduled) return;
    this.scheduled = true;
    this.rafId = this.scheduleFrame(() => {
      this.scheduled = false;
      const pending = this.pending;
      this.pending = null;
      if (!pending) return;
      const nextJson = JSON.stringify(pending.config);
      this.lastPackId = pending.packId;
      this.lastJson = nextJson;
      this.onPost(pending.packId, pending.config);
    });
  }

  cancel(): void {
    this.pending = null;
    if (this.scheduled) {
      this.cancelFrame(this.rafId);
      this.scheduled = false;
    }
  }

  reset(): void {
    this.cancel();
    this.lastJson = "";
    this.lastPackId = "";
  }
}
