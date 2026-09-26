import type { VizDataFrame } from "../plugins/viz-host";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";

export type VizPackFallbackText = (frame: VizDataFrame) => string;

export const SHADER_FALLBACK_CLASS = "tile-shader-fallback";
export const SHADER_FALLBACK_CHIP_CLASS = "tile-shader-fallback-chip";

export interface TileShaderFallbackOpts {
  packName: string;
  fallbackText?: VizPackFallbackText;
}

/** One centred fallback line (+ optional chip) over the idle backdrop for a pane. */
export class TileShaderFallback {
  private readonly root: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private readonly chip: HTMLSpanElement;
  private lastWritten = "";
  private readonly hasPackFallback: boolean;
  private readonly fallbackText?: VizPackFallbackText;

  constructor(readonly mount: HTMLElement, opts: TileShaderFallbackOpts) {
    this.fallbackText = opts.fallbackText;
    this.hasPackFallback = typeof opts.fallbackText === "function";
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
    if (this.hasPackFallback) this.root.appendChild(this.chip);
    mount.appendChild(this.root);
    const generic = genericShaderFallbackMessage(opts.packName);
    this.writeText(this.hasPackFallback ? "" : generic);
  }

  get element(): HTMLDivElement {
    return this.root;
  }

  get textNode(): HTMLSpanElement {
    return this.text;
  }

  frame(frame: VizDataFrame): void {
    if (!this.hasPackFallback || !this.fallbackText) return;
    const next = this.fallbackText(frame);
    if (next !== this.lastWritten) this.writeText(next);
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
