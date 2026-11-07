/**
 * Pane sizes for the per-frame present tick, measured by a ResizeObserver instead of reading
 * clientWidth/clientHeight on every pane every frame (a forced layout when anything above wrote
 * style that frame). The first ask measures once and starts observing; later asks are a lookup.
 */

type Size = { w: number; h: number };
type RO = { observe(el: Element): void; unobserve(el: Element): void; disconnect(): void };
type ROCtor = new (cb: (entries: readonly { target: Element; contentRect: { width: number; height: number } }[]) => void) => RO;

export class PaneSizeCache {
  private readonly sizes = new WeakMap<Element, Size>();
  private readonly ro: RO | null;

  constructor(ctor: ROCtor | null | undefined = (globalThis as { ResizeObserver?: ROCtor }).ResizeObserver) {
    this.ro = ctor
      ? new ctor((entries) => {
          for (const e of entries) this.sizes.set(e.target, { w: e.contentRect.width, h: e.contentRect.height });
        })
      : null;
  }

  /** CSS-pixel size of `el`; null when it has no area. */
  size(el: (Element & { clientWidth: number; clientHeight: number }) | null | undefined): Size | null {
    if (!el) return null;
    let s = this.sizes.get(el);
    if (!s || !this.ro) {
      s = { w: el.clientWidth, h: el.clientHeight };
      if (this.ro) {
        this.sizes.set(el, s);
        this.ro.observe(el);
      }
    }
    return s.w > 0 && s.h > 0 ? s : null;
  }

  aspect(el: (Element & { clientWidth: number; clientHeight: number }) | null | undefined): number | undefined {
    const s = this.size(el);
    return s ? s.w / s.h : undefined;
  }

  pixels(el: (Element & { clientWidth: number; clientHeight: number }) | null | undefined): number | undefined {
    const s = this.size(el);
    return s ? s.w * s.h : undefined;
  }

  /** Stop observing an element that left the page (a dropped mosaic pane). */
  forget(el: Element): void {
    this.sizes.delete(el);
    this.ro?.unobserve(el);
  }
}
