import { genericShaderFallbackMessage } from "./shader-fallback-copy";

export const FALLBACK_GRACE_FRAMES = 30;

export interface TileShaderFallbackOpts {
  packName: string;
  /** Shader compile failure on a pack that can push simple-view text. */
  packPush?: boolean;
  /** Context-loss overlay — generic copy + chip immediately. */
  contextLoss?: boolean;
}

/** One centred fallback line (+ optional chip) over the idle backdrop for a pane. */
export class TileShaderFallback {
  private readonly root: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private readonly chip: HTMLSpanElement;
  private lastWritten = "";
  private readonly packName: string;
  private readonly packPush: boolean;
  private readonly contextLoss: boolean;
  private showChip = false;
  private packFnDead = false;
  private graceLeft = 0;
  private gotValidPush = false;

  constructor(readonly mount: HTMLElement, opts: TileShaderFallbackOpts) {
    this.packName = opts.packName;
    this.packPush = !!opts.packPush;
    this.contextLoss = !!opts.contextLoss;
    this.root = document.createElement("div");
    this.root.className = "tile-shader-fallback";
    this.text = document.createElement("span");
    this.text.className = "tile-shader-fallback__text";
    this.root.appendChild(this.text);
    this.chip = document.createElement("span");
    this.chip.className = "tile-shader-fallback-chip";
    this.chip.textContent = "Simple view";
    mount.appendChild(this.root);
    if (this.contextLoss) {
      this.reveal();
      this.setShowChip(true);
    } else if (this.packPush) {
      this.graceLeft = FALLBACK_GRACE_FRAMES;
      this.root.style.visibility = "hidden";
    } else {
      this.reveal();
      this.writeText(genericShaderFallbackMessage(this.packName));
    }
  }

  get chipVisible(): boolean {
    return this.showChip;
  }

  get writes(): number {
    return (this.text as HTMLSpanElement & { __writes?: number }).__writes ?? 0;
  }

  setShowChip(on: boolean): void {
    this.showChip = on;
    if (on && !this.chip.parentElement) this.root.appendChild(this.chip);
    if (!on) this.chip.remove();
  }

  /** Pack contract push — host dedupes; whitespace is not a push. */
  pushPackText(text: string): void {
    if (this.packFnDead || this.contextLoss) return;
    if (!text.trim()) return;
    this.gotValidPush = true;
    this.graceLeft = 0;
    try {
      this.reveal();
      if (this.packPush) this.setShowChip(true);
      this.writeText(text);
    } catch {
      this.latchGeneric();
    }
  }

  tickGrace(): void {
    if (this.packFnDead || this.contextLoss || !this.packPush) return;
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
    try {
      this.writeText(genericShaderFallbackMessage(this.packName));
    } catch {
      /* latched */
    }
  }

  private writeText(next: string): void {
    if (next === this.lastWritten) return;
    this.lastWritten = next;
    this.text.textContent = next;
    const tagged = this.text as HTMLSpanElement & { __writes?: number };
    tagged.__writes = (tagged.__writes ?? 0) + 1;
  }

  dispose(): void {
    this.root.remove();
  }
}
