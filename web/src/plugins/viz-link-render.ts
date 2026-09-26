import type { VizLinkSample } from "./viz-host";

const LINK_PALETTE = [
  "#4fc3f7",
  "#81c784",
  "#ffb74d",
  "#f06292",
  "#9575cd",
  "#4db6ac",
  "#ff8a65",
  "#aed581",
] as const;

/** Stable render key from endpoints only (no slot / rank). */
export function vizLinkRenderKey(src: string, dst: string): string {
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  for (let i = 0; i < dst.length; i++) h = Math.imul(h ^ dst.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Palette colour from (src, dst) hash — pure function, no stored rank state. */
export function vizLinkRenderColor(src: string, dst: string): string {
  const h = Number.parseInt(vizLinkRenderKey(src, dst), 16);
  return LINK_PALETTE[h % LINK_PALETTE.length]!;
}

function pairKey(src: string, dst: string): string {
  return `${src}\0${dst}`;
}

/** Tracks index membership for fade-in (production consumer of {@link VizDataFrame.links}). */
export class VizLinkFadeTracker {
  private readonly indexed = new Set<string>();
  private fadeIns = 0;

  get indexedCount(): number {
    return this.indexed.size;
  }

  get fadeInCount(): number {
    return this.fadeIns;
  }

  reset(): void {
    this.indexed.clear();
    this.fadeIns = 0;
  }

  notePruned(src: string, dst: string): void {
    this.indexed.delete(pairKey(src, dst));
  }

  /** Call once per delivered frame after link collection. */
  observeLinks(links: readonly VizLinkSample[]): void {
    for (let i = 0; i < links.length; i++) {
      const l = links[i]!;
      const k = pairKey(l.src, l.dst);
      if (this.indexed.has(k)) continue;
      this.indexed.add(k);
      this.fadeIns++;
    }
  }
}

export const vizLinkFadeTracker = new VizLinkFadeTracker();
