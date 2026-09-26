import type { VizDataFrame } from "../plugins/viz-host";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";

export type VizPackFallbackText = (frame: VizDataFrame) => string;

export interface TileShaderFallbackOpts {
  packName: string;
  /** Shader compile failure without pack text — show generic line immediately. */
  genericOnly?: boolean;
  /** Show the “Simple view” chip (pack simple view or context loss). */
  showChip?: boolean;
}

/** One centred fallback line (+ optional chip) over the idle backdrop for a pane. */
export class TileShaderFallback {
  private readonly root: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private readonly chip: HTMLSpanElement;
  private lastWritten = "";
  private readonly packName: string;
  private readonly genericOnly: boolean;
  private showChip: boolean;
  private packFnDead = false;

  constructor(readonly mount: HTMLElement, opts: TileShaderFallbackOpts) {
    this.packName = opts.packName;
    this.genericOnly = !!opts.genericOnly;
    this.showChip = !!opts.showChip;
    this.root = document.createElement("div");
    this.root.className = "tile-shader-fallback";
    this.text = document.createElement("span");
    this.text.className = "tile-shader-fallback__text";
    this.root.appendChild(this.text);
    this.chip = document.createElement("span");
    this.chip.className = "tile-shader-fallback-chip";
    this.chip.textContent = "Simple view";
    if (this.showChip) this.root.appendChild(this.chip);
    mount.appendChild(this.root);
    if (this.genericOnly) {
      this.writeText(genericShaderFallbackMessage(this.packName));
    }
  }

  get chipVisible(): boolean {
    return this.showChip;
  }

  setShowChip(on: boolean): void {
    this.showChip = on;
    if (on && !this.chip.parentElement) this.root.appendChild(this.chip);
    if (!on) this.chip.remove();
  }

  /** Host path: pack contract `fallbackText` updates (write-on-change). */
  pushPackText(text: string): void {
    if (this.genericOnly || this.packFnDead) return;
    try {
      if (!text.trim()) {
        this.latchGeneric();
        return;
      }
      this.writeText(text);
    } catch {
      this.latchGeneric();
    }
  }

  frame(_frame: VizDataFrame): void {
    /* pack lines arrive via pushPackText from the plugin contract */
  }

  private latchGeneric(): void {
    if (this.packFnDead) return;
    this.packFnDead = true;
    this.setShowChip(false);
    try {
      this.writeText(genericShaderFallbackMessage(this.packName));
    } catch {
      /* latched — generic copy must not throw out of pushPackText */
    }
  }

  private writeText(next: string): void {
    if (next === this.lastWritten) return;
    this.lastWritten = next;
    this.text.textContent = next;
  }

  dispose(): void {
    this.root.remove();
  }
}
