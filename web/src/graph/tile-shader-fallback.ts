import { genericShaderFallbackMessage } from "./shader-fallback-copy";

const FALLBACK_GRACE_FRAMES = 30;

export interface TileShaderFallbackOpts {
  packName: string;
  /** Pack implements fallbackText — grace then simple-view chip + pushed line. */
  packPush?: boolean;
  skipGrace?: boolean;
  initialText?: string;
}

/** One centred fallback line (+ optional chip) over the idle backdrop for a pane. */
export class TileShaderFallback {
  private readonly root: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private readonly chip: HTMLSpanElement;
  private lastWritten = "";
  private readonly packName: string;
  private readonly packPush: boolean;
  private showChip = false;
  private packFnDead = false;
  private graceLeft = 0;
  private gotValidPush = false;

  constructor(readonly mount: HTMLElement, opts: TileShaderFallbackOpts) {
    this.packName = opts.packName;
    this.packPush = !!opts.packPush;
    this.root = document.createElement("div");
    this.root.className = "tile-shader-fallback";
    this.text = document.createElement("span");
    this.text.className = "tile-shader-fallback__text";
    this.root.appendChild(this.text);
    this.chip = document.createElement("span");
    this.chip.className = "tile-shader-fallback-chip";
    this.chip.textContent = "Simple view";
    mount.appendChild(this.root);
    if (this.packPush) {
      if (opts.skipGrace || opts.initialText) {
        this.graceLeft = 0;
        this.gotValidPush = !!opts.initialText?.trim();
        if (opts.initialText?.trim()) {
          this.reveal();
          this.setShowChip(true);
          this.writeText(opts.initialText);
        } else {
          this.root.style.visibility = "hidden";
        }
      } else {
        this.graceLeft = FALLBACK_GRACE_FRAMES;
        this.root.style.visibility = "hidden";
      }
    } else {
      this.reveal();
      this.writeText(genericShaderFallbackMessage(this.packName));
    }
  }

  private setShowChip(on: boolean): void {
    this.showChip = on;
    if (on && !this.chip.parentElement) this.root.appendChild(this.chip);
    if (!on) this.chip.remove();
  }

  /** Pack contract push — host dedupes; whitespace is not a push. */
  pushPackText(text: string): void {
    if (this.packFnDead) return;
    if (!text.trim()) return;
    this.gotValidPush = true;
    this.graceLeft = 0;
    this.reveal();
    if (this.packPush) this.setShowChip(true);
    this.writeText(text);
  }

  tickGrace(): void {
    if (this.packFnDead || !this.packPush) return;
    if (this.gotValidPush) return;
    if (this.graceLeft <= 0) return;
    this.graceLeft--;
    if (this.graceLeft === 0) this.latchGeneric();
  }

  private reveal(): void {
    this.root.style.visibility = "";
  }

  private latchGeneric(): void {
    if (this.packFnDead) return;
    this.packFnDead = true;
    this.graceLeft = 0;
    this.setShowChip(false);
    this.reveal();
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
