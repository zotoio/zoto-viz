export interface TileShaderFallbackOpts {
  packName: string;
  showChip: boolean;
  initialText: string;
}

/** One centred fallback line (+ optional chip) over the idle backdrop for a pane. */
export class TileShaderFallback {
  private readonly root: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private readonly chip: HTMLSpanElement;
  private lastWritten = "";

  constructor(readonly mount: HTMLElement, opts: TileShaderFallbackOpts) {
    this.root = document.createElement("div");
    this.root.className = "tile-shader-fallback";
    this.text = document.createElement("span");
    this.text.className = "tile-shader-fallback__text";
    this.root.appendChild(this.text);
    this.chip = document.createElement("span");
    this.chip.className = "tile-shader-fallback-chip";
    this.chip.textContent = "Simple view";
    mount.appendChild(this.root);
    if (opts.showChip) this.root.appendChild(this.chip);
    this.applyText(opts.initialText);
  }

  applyText(next: string): void {
    if (next === this.lastWritten) return;
    this.lastWritten = next;
    this.text.textContent = next;
  }

  dispose(): void {
    this.root.remove();
  }
}
