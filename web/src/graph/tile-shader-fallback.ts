import type { VizDataFrame } from "../plugins/viz-host";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";

export type VizPackFallbackText = (frame: VizDataFrame) => string;

export const SHADER_FALLBACK_CLASS = "tile-shader-fallback";
export const SHADER_FALLBACK_CHIP_CLASS = "tile-shader-fallback-chip";

export interface TileShaderFallbackOpts {
  packName: string;
  /** When set, simple-view updates run; generic-only tiles omit this. */
  fallbackText?: VizPackFallbackText;
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
  private fallbackText?: VizPackFallbackText;
  private packFnDead = false;
  private readonly genericOnly: boolean;
  private showChip: boolean;

  constructor(readonly mount: HTMLElement, opts: TileShaderFallbackOpts) {
    this.packName = opts.packName;
    this.fallbackText = opts.fallbackText;
    this.genericOnly = !!opts.genericOnly;
    this.showChip = !!opts.showChip;
    this.root = document.createElement("div");
    this.root.className = SHADER_FALLBACK_CLASS;
    this.root.style.backgroundColor = "rgba(18, 22, 31, 0.94)";
    this.root.setAttribute("aria-hidden", "true");
    this.root.tabIndex = -1;
    this.text = document.createElement("span");
    this.text.className = "tile-shader-fallback__text";
    this.root.appendChild(this.text);
    this.chip = document.createElement("span");
    this.chip.className = SHADER_FALLBACK_CHIP_CLASS;
    this.chip.textContent = "Simple view";
    if (this.showChip) this.root.appendChild(this.chip);
    mount.appendChild(this.root);
    if (this.genericOnly) {
      this.writeText(genericShaderFallbackMessage(this.packName));
    }
  }

  get element(): HTMLDivElement {
    return this.root;
  }

  get textNode(): HTMLSpanElement {
    return this.text;
  }

  get chipVisible(): boolean {
    return this.showChip;
  }

  setShowChip(on: boolean): void {
    this.showChip = on;
    if (on && !this.chip.parentElement) this.root.appendChild(this.chip);
    if (!on) this.chip.remove();
  }

  frame(frame: VizDataFrame): void {
    if (this.genericOnly || this.packFnDead || !this.fallbackText) return;
    try {
      const next = this.fallbackText(frame);
      if (!next.trim()) {
        this.latchGeneric();
        return;
      }
      if (next !== this.lastWritten) this.writeText(next);
    } catch {
      this.latchGeneric();
    }
  }

  private latchGeneric(): void {
    if (this.packFnDead) return;
    this.packFnDead = true;
    this.fallbackText = undefined;
    this.setShowChip(false);
    this.writeText(genericShaderFallbackMessage(this.packName));
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
